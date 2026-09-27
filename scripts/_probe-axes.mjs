#!/usr/bin/env node
/**
 * 轴向策略验证（2026-09-21 用户口径）：
 *   轨道界面 → 拍数栏只能横向、轨道列只能纵向
 *   参数界面 → 拍数栏只能横向、琴键列只能纵向
 *
 * 做法：对每个「表面」各注入一次**横向**捏合与一次**纵向**捏合，读视口真值，
 * 报告四件事各自有没有变：pxPerSec / rowHeight / scrollLeft / scrollTop。
 * 期望（受限轴不得被写）：
 *   拍数栏  → 横捏：只动 pxPerSec(+scrollLeft)；纵捏：**什么都不动**
 *   轨道列  → 纵捏：只动 rowHeight(+scrollTop)；横捏：**什么都不动**
 *   画布    → 两个方向都能动（对照）
 *
 * 用法：node scripts/_probe-axes.mjs --tab timeline --surface ruler
 *       node scripts/_probe-axes.mjs --tab params   --surface keys
 *       node scripts/_probe-axes.mjs --tab timeline --surface tracklist
 *       node scripts/_probe-axes.mjs --tab timeline --surface canvas
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', host: '127.0.0.1', port: 9222, tab: 'timeline', surface: 'ruler', dir: 'out', only: 'both', steps: 12, hold: 60 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--tab') o.tab = argv[++i];
        else if (a === '--surface') o.surface = argv[++i];
        else if (a === '--dir') o.dir = argv[++i];
        else if (a === '--only') o.only = argv[++i];
        else if (a === '--steps') o.steps = Number(argv[++i]);
    }
    return o;
}

function fwd(serial) {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();
    console.log(`▸ adb forward: tcp:9222 → webview_devtools_remote_${pid}`);
}

/** 在页面里按几何找目标表面，返回中心点与 rect。 */
function inPageFindSurface(surface, tab) {
  try {
    const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, w: r.width, h: r.height };
    };
    const none = [...document.querySelectorAll('*')].filter(
        (e) => e.style && e.style.touchAction === 'none',
    );
    const vp = window.__hsViewport ? window.__hsViewport() : null;
    const pv = window.__hsParamViewport ? window.__hsParamViewport() : null;
    // ⚠️ `__hsViewport().containerRect` 用的是 {width,height}，本函数的 rect() 用 {w,h}
    // —— 不归一化就会拿到 undefined 并算出 NaN（elementFromPoint 直接抛非有限值）。
    const norm = (b) => (b ? { left: b.left, top: b.top, w: b.width ?? b.w, h: b.height ?? b.h } : null);
    const base =
        tab === 'timeline'
            ? norm(vp?.containerRect ?? null)
            : pv
              ? norm(rect(document.querySelector('[data-piano-roll-scroller]')))
              : null;
    if (!base || !Number.isFinite(base.w) || !Number.isFinite(base.h)) return { error: 'no-base', candidates: none.map((e) => `${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`).slice(0, 6) };

    let pick = null;
    if (surface === 'ruler') {
        // 宽扁、在容器上方
        pick = none
            .map((e) => ({ e, r: rect(e) }))
            .filter((x) => x.r.h <= 68 && x.r.w >= 180 && x.r.top + x.r.h <= base.top + 2)
            .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h)[0];
    } else if (surface === 'tracklist' || surface === 'keys') {
        // 容器左侧的窄高条
        pick = none
            .map((e) => ({ e, r: rect(e) }))
            .filter((x) => x.r.left + x.r.w <= base.left + 2 && x.r.h >= 120 && x.r.w >= 40)
            .sort((a, b) => b.r.h - a.r.h)[0];
        if (!pick) {
            // 轨道列**没有** touch-action:none（它是原生滚动容器，靠 suppressTwoFingerScroll
            // 只压双指）⇒ 按稳定标识找：TrackList 的滚动元素带 `data-track-list-panel`。
            // 🕳️ 别用 elementFromPoint(容器左边 - 40) 猜：那里常常是 M/S/C 小按钮（20×20），
            // 半径会小到低于轴锁阈值，看起来像"什么都不动"（实测踩过）。
            const el = document.querySelector('[data-track-list-panel]');
            if (el) pick = { e: el, r: rect(el) };
        }
    } else {
        pick = none
            .map((e) => ({ e, r: rect(e) }))
            .filter((x) => x.r.w >= 120 && x.r.h >= 120 && Math.abs(x.r.left - base.left) < 4)
            .sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h)[0];
    }
    if (!pick) {
        return {
            error: 'no-surface',
            base,
            candidates: none
                .map((e) => ({ c: `${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)} @${Math.round(e.getBoundingClientRect().left)},${Math.round(e.getBoundingClientRect().top)}`, r: rect(e) }))
                .slice(0, 10),
        };
    }
    const r = pick.r;
    return {
        x: +(r.left + r.w / 2).toFixed(1),
        y: +(r.top + r.h / 2).toFixed(1),
        w: +r.w.toFixed(1),
        h: +r.h.toFixed(1),
        cls: String(pick.e.className || '').slice(0, 40),
        base,
    };
  } catch (e) {
    return { error: 'threw: ' + (e && e.message ? e.message : String(e)) };
  }
}

async function main() {
    const o = parseArgs(process.argv);
    fwd(o.serial);
    const cdp = await Cdp.attach({ host: o.host, port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* 某些版本没有这个方法，忽略 */
    }

    const tgt = await cdp.call(inPageFindSurface, o.surface, o.tab);
    if (!tgt || tgt.error) {
        console.log('❌ 找不到目标表面:', JSON.stringify(tgt, null, 1));
        cdp.close();
        process.exit(2);
    }
    console.log(`▸ 表面 ${o.surface} @ ${o.tab}  ${tgt.w}×${tgt.h} @ (${tgt.x},${tgt.y})  [${tgt.cls}]`);

    const readVP = async () => {
        await sleep(180);
        if (o.tab === 'params') {
            return cdp.call(() => {
                const v = window.__hsParamViewport ? window.__hsParamViewport() : null;
                if (!v) return null;
                return {
                    pxPerSec: v.pxPerSec,
                    rowHeight: v.rowHeight,
                    scrollLeft: v.scrollLeft,
                    scrollTop: -v.center / Math.max(1e-9, v.span / Math.max(1, v.viewportHeight)),
                    span: v.span,
                    center: v.center,
                    // ⚠️ **独立观测量**：`__hsParamViewport().span` 读的是 `pitchViewRef`，
                    // 而双指提交走的是 `syncVerticalScrollbarForViewport`（只写内核镜像，
                    // **不**回写那个 ref）⇒ span 可能是旧值。竖滚动条 thumb 的高度随 span
                    // 变化，是内核真值的代理量，用它交叉验证。
                    thumbH: (() => {
                        const vbar = [...document.querySelectorAll('[class*=hs-sb-v]')]
                            .filter((e) => e.getBoundingClientRect().height > 0)[0];
                        if (!vbar) return null;
                        const th = vbar.querySelector('[class*=thumb]') || vbar.firstElementChild;
                        return th ? Math.round(th.getBoundingClientRect().height) : null;
                    })(),
                };
            });
        }
        return cdp.call(() => (window.__hsViewport ? window.__hsViewport() : null));
    };

    async function touch(type, points) {
        await cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });
    }
    async function drive(pts) {
        const n = Math.max(2, o.steps);
        await touch('touchStart', [pts(0)[0]]);
        await sleep(o.hold);
        await touch('touchStart', pts(0));
        await sleep(o.hold);
        for (let i = 1; i <= n; i++) {
            await touch('touchMove', pts(i / n));
            await sleep(300 / n);
        }
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(260);
    }

    // ⚠️ 两个轴**分别**算半径：窄条（拍数栏只有 48px 高）如果按 min(w,h) 取半径，
    // 初始横向间距会小于控制器的轴锁阈值（axisLockPx=24）⇒ `axisLockX` 为真
    // ⇒ 横捏被判成"没锁开"，看起来像"缩放无效"（实测踩过）。
    const maxRX = Math.max(16, tgt.w / 2 - 8);
    const maxRY = Math.max(8, tgt.h / 2 - 4);
    // out = 张开（放大/行高增大）；in = 收拢（缩小）—— 量轴向前先确认目标轴**有余量**：
    // 行高上限就是 192，如果当前已经是 192，往外捏只会被钳住、看起来像"没生效"。
    const wantIn = o.dir === 'in';
    const rx1 = +((wantIn ? maxRX * 0.9 : maxRX * 0.35)).toFixed(1);
    const rx2 = +((wantIn ? maxRX * 0.35 : maxRX * 0.9)).toFixed(1);
    const ry1 = +((wantIn ? maxRY * 0.9 : maxRY * 0.35)).toFixed(1);
    const ry2 = +((wantIn ? maxRY * 0.35 : maxRY * 0.9)).toFixed(1);
    console.log(`▸ 捏合半径(${o.dir}) X ${rx1}→${rx2}   Y ${ry1}→${ry2}\n`);

    const changed = (a, b) => {
        const out = [];
        for (const k of ['pxPerSec', 'rowHeight', 'scrollLeft', 'scrollTop', 'span', 'center', 'thumbH']) {
            if (a[k] == null || b[k] == null) continue;
            if (Math.abs(a[k] - b[k]) > 1e-6) out.push(`${k} ${(+a[k]).toFixed(3)}→${(+b[k]).toFixed(3)}`);
        }
        return out;
    };

    if (o.only !== 'y')
    // 横捏（X 分离度变化，中点固定）
    {
        const v0 = await readVP();
        await drive((k) => [
            { id: 1, x: tgt.x - (rx1 + (rx2 - rx1) * k), y: tgt.y },
            { id: 2, x: tgt.x + (rx1 + (rx2 - rx1) * k), y: tgt.y },
        ]);
        const v1 = await readVP();
        const d = changed(v0, v1);
        console.log(`横捏 : ${d.length ? d.join('  |  ') : '（无变化）'}`);
    }

    if (o.only !== 'x')
    // 纵捏（Y 分离度变化，中点固定）
    {
        const v0 = await readVP();
        await drive((k) => [
            { id: 1, x: tgt.x, y: tgt.y - (ry1 + (ry2 - ry1) * k) },
            { id: 2, x: tgt.x, y: tgt.y + (ry1 + (ry2 - ry1) * k) },
        ]);
        const v1 = await readVP();
        const d = changed(v0, v1);
        console.log(`纵捏 : ${d.length ? d.join('  |  ') : '（无变化）'}`);
    }

    cdp.close();
}

await main();
