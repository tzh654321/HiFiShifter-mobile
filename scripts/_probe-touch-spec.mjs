#!/usr/bin/env node
/**
 * 触屏交互规格表（`docs/临时.xlsx` / `docs/15`）逐条实测。
 *
 * 规格里未打 ✅ 的 8 格：
 *   ① 轨道-划动            = 平移视野
 *   ② 音频块-单击          = 选中并显示常用操作与左右控制点（需音频块）
 *   ③ 音频块-划动          = 未选中平移 / 已选中拖动块 / 淡入淡出区调时长（需音频块）
 *   ④ 轨道头-划动          = 上下划平移视野；左划隐藏轨道头（只留颜色线与电平条）；右划展开
 *   ⑤ 轨道-长按并划动      = 相当于右键框选
 *   ⑥ 轨道头-长按并划动    = 移动轨道顺序
 *   ⑦ 控制点-长按并划动    = 上划后横滑调淡入淡出 / 下划后横滑调变速（需音频块）
 *   ⑧ 拍数栏-双击          = 移动进度条并开始播放
 *
 * 本脚本覆盖**不需要音频块**的 ①④⑤⑥⑧（②③⑦ 见 `--blocks` 分支，需要先造出音频块）。
 *
 * 用法：node scripts/_probe-touch-spec.mjs --serial emulator-5554 [--only 1,4,8]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, only: '' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--only') o.only = argv[++i];
    }
    o.want = o.only ? new Set(o.only.split(',').map((s) => s.trim())) : null;
    return o;
}

/** 页面内取一份「全局状态快照」（自包含）。 */
function inPageSnapshot() {
    const vp = window.__hsViewport ? window.__hsViewport() : null;
    const labels = [...document.querySelectorAll('button')].map((b) => b.ariaLabel).filter(Boolean);
    const panel = document.querySelector('[data-track-list-panel]');
    const trackNames = panel
        ? [...panel.querySelectorAll('.rt-Text')].map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 24)
        : [];
    const marquee = [...document.querySelectorAll('[class*=marquee],[data-marquee],[class*=selection-box]')].length;
    return {
        collapsed: document.body.getAttribute('data-hs-header-collapsed'),
        // ⚠️ 不能看 labels.includes('停止') —— 底栏的「停止」按钮**恒定存在**。
        // 要看**播放按钮自己**的标签：「播放」= 停止态，换成「暂停」之类才是播放中。
        playing: (() => {
            const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '播放' || x.ariaLabel === '暂停');
            return b ? b.ariaLabel !== '播放' : null;
        })(),
        playheadX: (() => {
            const el = document.querySelector('[class*=bg-qt-playhead]');
            return el ? Math.round(el.getBoundingClientRect().left) : null;
        })(),
        scrollLeft: vp ? Math.round(vp.scrollLeft) : null,
        scrollTop: vp ? Math.round(vp.scrollTop) : null,
        pxPerSec: vp ? Math.round(vp.pxPerSec) : null,
        trackNames: trackNames.slice(0, 6),
        marqueeCount: marquee,
    };
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    /** 单指划动 */
    async function swipe(x1, y1, x2, y2, ms = 320) {
        const n = 10;
        await touch('touchStart', [{ id: 0, x: x1, y: y1 }]);
        for (let i = 1; i <= n; i++) {
            await touch('touchMove', [{ id: 0, x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n }]);
            await sleep(ms / n);
        }
        await touch('touchEnd', []);
        await sleep(350);
    }
    /** 长按后划动（长按 600ms 再位移） */
    async function longPressSwipe(x1, y1, x2, y2, ms = 320) {
        const n = 10;
        await touch('touchStart', [{ id: 0, x: x1, y: y1 }]);
        await sleep(620);
        for (let i = 1; i <= n; i++) {
            await touch('touchMove', [{ id: 0, x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n }]);
            await sleep(ms / n);
        }
        await touch('touchEnd', []);
        await sleep(400);
    }
    /** 双击（两次 tap，间隔 90ms） */
    async function doubleTap(x, y) {
        for (let k = 0; k < 2; k++) {
            await touch('touchStart', [{ id: 0, x, y }]);
            await sleep(60);
            await touch('touchEnd', []);
            if (k === 0) await sleep(90);
        }
        await sleep(500);
    }

    const snap = () => cdp.call(inPageSnapshot);
    const results = [];
    const check = (id, name, ok, detail) => {
        results.push({ id, name, ok, detail });
        console.log(`${ok ? '✅' : '🔴'} ①${id} ${name}\n     ${detail}`);
    };
    const want = (id) => !o.want || o.want.has(String(id));

    const s0 = await snap();
    console.log(`▸ 基线：${JSON.stringify({ collapsed: s0.collapsed, playing: s0.playing, scrollLeft: s0.scrollLeft, scrollTop: s0.scrollTop, tracks: s0.trackNames })}`);
    console.log(`▸ 视口 ${(await cdp.call(() => ({ w: innerWidth, h: innerHeight }))).w}×${(await cdp.call(() => ({ w: innerWidth, h: innerHeight }))).h}\n`);

    // ── ① 轨道-划动 = 平移视野 ───────────────────────────────────────────
    if (want(1)) {
        const a = await snap();
        await swipe(300, 400, 200, 400); // 在轨道内容区向左划
        const b = await snap();
        check(1, '轨道-划动 = 平移视野', a.scrollLeft !== b.scrollLeft, `scrollLeft ${a.scrollLeft} → ${b.scrollLeft}`);
    }

    // ── ④ 轨道头-划动 ────────────────────────────────────────────────────
    if (want(4)) {
        const a = await snap();
        await swipe(120, 300, 40, 300); // 轨道头上向左划
        const b = await snap();
        const collapsedNow = b.collapsed === '1';
        // 收窄后：轨道头应只剩窄条（读面板宽）
        const w = await cdp.call(() => {
            const el = document.querySelector('[data-track-list-panel]');
            return el ? Math.round(el.getBoundingClientRect().width) : null;
        });
        check(4, '轨道头-左划 = 隐藏（只留颜色线与电平条）', collapsedNow, `collapsed ${a.collapsed} → ${b.collapsed}；轨道头列宽=${w}`);
        // 收窄后轨道头只剩 26px 宽 ⇒ **右划的起点必须落在这 26px 里**，
        // 否则事件根本不进 `trackListEl`（第一版探针从 x=40 起划，误判成"右划没实现"）。
        // ⚠️ 收起会让布局**重排**（左上角那行整行隐藏 ⇒ 轨道行整体上移一截），
        // 紧接着就右划有概率落在"重排中途"的落点上（实测偶发失败一次）。
        await sleep(450);
        await swipe(12, 300, 110, 300); // 右划恢复
        const c = await snap();
        // 诊断：右划若没生效，把"触摸落点上方是谁"和面板宽度一并打出来。
        if (c.collapsed === '1') {
            const diag = await cdp.call(() => {
                const el = document.elementFromPoint(12, 300);
                const panel = document.querySelector('[data-track-list-panel]');
                const pr = panel ? panel.getBoundingClientRect() : null;
                const chain = [];
                let cur = el;
                for (let i = 0; i < 5 && cur; i++) {
                    chain.push(`${cur.tagName}.${String(cur.className).slice(0, 30)}`);
                    cur = cur.parentElement;
                }
                return {
                    at: chain,
                    panel: pr ? `${Math.round(pr.left)},${Math.round(pr.top)} ${Math.round(pr.width)}x${Math.round(pr.height)}` : null,
                    panelScrollTop: panel ? panel.scrollTop : null,
                    scrollHeight: panel ? panel.scrollHeight : null,
                    clientHeight: panel ? panel.clientHeight : null,
                };
            });
            console.log('  ⚠️ ④b 诊断：' + JSON.stringify(diag));
        }
        check('4b', '轨道头-右划 = 展开', c.collapsed !== '1', `collapsed → ${c.collapsed}`);
    }

    // ── ⑤ 轨道-长按并划动 = 框选 ─────────────────────────────────────────
    if (want(5)) {
        /** 内核的框选矩形是它自己创建的 div（`border: 1px dashed`），读它最直接。 */
        const readBox = () =>
            cdp.call(() =>
                [...document.querySelectorAll('div')]
                    .filter((d) => String(d.style.border || '').includes('dashed'))
                    .map((d) => ({
                        display: d.style.display,
                        w: Math.round(d.getBoundingClientRect().width),
                        h: Math.round(d.getBoundingClientRect().height),
                    })),
            );
        const a = await readBox();
        /* ⚠️ 必须**同一次触摸**里"先长按、再拖"：分成两次触摸的话，第一次抬手就把
           长按候选清掉了，第二次只是普通划动（= 平移视野）。而且矩形只在拖动期间显示，
           抬手即收尾 ⇒ 读数要在**按住时**做。 */
        await touch('touchStart', [{ id: 0, x: 200, y: 300 }]);
        await sleep(750); // 越过 500ms 长按阈值 → 升级 box-select
        await touch('touchMove', [{ id: 0, x: 235, y: 345 }]);
        await sleep(180);
        await touch('touchMove', [{ id: 0, x: 300, y: 420 }]);
        await sleep(200);
        const mid = await readBox();
        await touch('touchEnd', []);
        await sleep(400);
        const shown = mid.some((b) => b.display !== 'none' && b.w > 20 && b.h > 20);
        check(
            5,
            '轨道-长按并划动 = 右键框选',
            shown,
            `框选矩形 前=${JSON.stringify(a)} 拖动中=${JSON.stringify(mid)}`,
        );
    }

    // ── ⑥ 轨道头-长按并划动 = 移动轨道顺序 ──────────────────────────────
    if (want(6)) {
        const order = () =>
            cdp.call(() =>
                [...new Set([...document.querySelectorAll('[data-track-list-panel] [data-track-id]')].map((e) => e.getAttribute('data-track-id')))],
            );
        /**
         * 先确保有 ≥ 2 条轨道。
         *
         * 「移动轨道顺序」只有在**两条以上**时才可观测：工程刚打开时只有 `track_main`
         * 一条，重排前后数组一模一样 ⇒ 探针报"未实现"（假阴暗）。这里点「添加轨道」
         * 那一行（`TrackList` 里是带 `border-dashed` 的可点 `Flex`，没有 data 属性，
         * 只能按类名 + 文案定位）。
         */
        const addTrack = () =>
            cdp.call(() => {
                const row = [...document.querySelectorAll('[data-track-list-panel] div')].find(
                    (d) =>
                        String(d.className).includes('border-dashed') &&
                        String(d.className).includes('cursor-pointer'),
                );
                if (!row) return false;
                row.click();
                return true;
            });
        for (let i = 0; i < 4; i++) {
            const cur = await order();
            if (cur.length >= 3) break;
            await addTrack();
            await sleep(900);
        }
        const seeded = await order();
        console.log(`▸ ⑥ 前置：轨道 ${JSON.stringify(seeded)}`);
        /**
         * 🕳️ **不能用 `Input.dispatchTouchEvent` 测这条**：那条路径下页面的
         * **原生 `touchstart/touchmove` 监听收不到完整序列**（轨道头「左划」能过是特例），
         * 于是"实现了也测不出来"。改为在页面里**派发真实 `TouchEvent`**——
         * 与真机手指产生的序列等价（`Touch` 构造器现代 Chromium 支持）。
         */
        const fire = (type, offsetY) =>
            cdp.call(
                (ty, off) => {
                    const row = document.querySelectorAll("[data-hs-track-row]")[0];
                    if (!row) return { error: "no-row" };
                    const b = row.getBoundingClientRect();
                    const yy = b.top + off;
                    const touches =
                        ty === "touchend"
                            ? []
                            : [new Touch({ identifier: 1, target: row, clientX: b.left + 20, clientY: yy })];
                    row.dispatchEvent(
                        new TouchEvent(ty, {
                            bubbles: true,
                            cancelable: true,
                            touches,
                            targetTouches: touches,
                            changedTouches: touches,
                        }),
                    );
                    return { ok: true, y: Math.round(yy), rows: document.querySelectorAll("[data-hs-track-row]").length };
                },
                type,
                offsetY,
            );

        const a = await order();
        const r0 = await fire('touchstart', 40);
        await sleep(700); // 越过 450ms 长按阈值
        await fire('touchmove', 340); // 往下跨一行多
        await sleep(250);
        await fire('touchend', 340);
        await sleep(1500);
        const b = await order();
        check(
            6,
            '轨道头-长按并划动 = 移动轨道顺序',
            JSON.stringify(a) !== JSON.stringify(b),
            `顺序 ${JSON.stringify(a)} → ${JSON.stringify(b)}（首次行数=${r0.rows}）`,
        );
    }

    // ── ⑧ 拍数栏-双击 = 移动进度条并开始播放 ────────────────────────────
    if (want(8)) {
        await cdp.call(() => {
            const el = [...document.querySelectorAll('button')].find((b) => b.ariaLabel === '停止');
            if (el) el.click(); // 确保先停下
        });
        await sleep(500);
        const a = await snap();
        await doubleTap(280, 69);
        await sleep(900);
        const b = await snap();
        check(
            8,
            '拍数栏-双击 = 移动进度条并开始播放',
            b.playing && b.playheadX !== a.playheadX,
            `playing ${a.playing} → ${b.playing}；播放头 x ${a.playheadX} → ${b.playheadX}`,
        );
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
}

await main();
