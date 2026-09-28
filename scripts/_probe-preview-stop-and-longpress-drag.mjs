#!/usr/bin/env node
/**
 * 真机验收（两个 bug）：
 *  ① 上游 bug「预览时按停止停不下来」—— 传输栏停止/起播必须同时掐掉文件浏览器试听；
 *  ② 跨界面拖动文件 —— **长按并拖动必须优先于「落指直接划动平移界面」**。
 *
 * 为什么必须用**真实触摸**驱动：② 的根因就是浏览器把纵向手势当滚动接管、随后派发
 * `pointercancel` 把我们的指针掐掉。合成 PointerEvent **永远复现不出来**（没有浏览器
 * 手势竞争），所以这里用 CDP `Input.dispatchTouchEvent` 走真触摸路径。
 *
 * 判据：
 *  ①-a 点文件行的试听 ⇒ 行进入试听态（`aria-pressed`/图标变化）
 *  ①-b 按传输栏「停止」⇒ 试听态被清掉（修复前一直停在试听态、声音不停）
 *  ②-a **按住 300ms 后拖动** ⇒ 派发 `hifi-file-drag:start`（长按优先，拖拽真的起来）
 *  ②-b 放手 ⇒ 轨道上多出一个块
 *  ②-c 反例：**落指立即快划**（不等待长按）⇒ **不**应触发拖拽（让浏览器滚列表）
 *
 * 用法：node scripts\_probe-preview-stop-and-longpress-drag.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const PKG = 'com.arounder.hifishifter';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    const pid = adb(`shell pidof ${PKG}`).trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    // 打开文件浏览器（并确保分屏：拖动需要轨道区做落点）
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const menuItem = async (name) => {
            const trig = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === '视图',
            );
            trig && trig.click();
            await wait(850);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) =>
                    ((x.getAttribute('aria-label') || '').trim() === name ||
                        (x.textContent || '').trim() === name) &&
                    x.children.length <= 3,
            );
            if (it) {
                it.click();
                await wait(1800);
            } else {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
        };
        const vis = (s) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 8 && r.width > 8;
        };
        if (!vis('[data-hs-surface="timeline"]')) await menuItem('轨道面板');
        if (!vis('[data-hs-split-handle="files"]')) await menuItem('文件浏览器');
        await wait(1500);
    });

    // ── ① 预览 + 停止 ────────────────────────────────────────────────
    const previewInfo = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // 找一行音频文件（点它 = 试听）
        const row = [...document.querySelectorAll('div,li')].find(
            (e) => /\.(wav|mp3|flac|m4a|ogg)$/i.test((e.innerText || '').trim()) && e.children.length <= 4,
        );
        if (!row) return { error: 'no-audio-row' };
        const r = row.getBoundingClientRect();
        return { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2), name: (row.innerText || '').trim().slice(0, 30) };
    });
    console.log('▸ 试听目标行：' + JSON.stringify(previewInfo));
    if (previewInfo.error) {
        console.log('🔴 文件面板里没有音频行（面板没打开/目录为空？）');
        cdp.close();
        return;
    }
    // 真触摸单击（试听）
    await touch('touchStart', [{ id: 0, x: previewInfo.x, y: previewInfo.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(1800);
    const playing1 = await cdp.call(() => ({
        enginePlaying: Boolean(window.__hsAudioPreview?.playing?.()),
    }));
    console.log('▸ 试听后：' + JSON.stringify(playing1));
    check(
        '①-a 单击文件行 ⇒ 试听引擎**确实在响**（true）',
        playing1.enginePlaying === true,
        JSON.stringify(playing1),
    );

    // 按传输栏「停止」（真触摸）
    const stopBtn = await cdp.call(() => {
        const b = [...document.querySelectorAll('button')].find(
            (x) => (x.getAttribute('data-tooltip') || x.ariaLabel || (x.textContent || '').trim()) === '停止',
        );
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (stopBtn) {
        await touch('touchStart', [{ id: 0, x: stopBtn.x, y: stopBtn.y }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(1200);
    }
    const afterStop = await cdp.call(() => ({
        enginePlaying: Boolean(window.__hsAudioPreview?.playing?.()),
    }));
    console.log('▸ 按停止后：' + JSON.stringify(afterStop));
    check(
        '①-b 传输栏「停止」把试听**真的停掉**（false）—— 修复前恒为 true',
        afterStop.enginePlaying === false,
        `按停止前=${playing1.enginePlaying}，之后=${afterStop.enginePlaying}；停止按钮位置=${JSON.stringify(stopBtn)}`,
    );

    // ── ② 长按并拖动（真触摸）────────────────────────────────────────
    const before = await cdp.call(
        async (px, py) => {
            const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
            const st = await inv('get_timeline_state', {});
            const row = document.querySelector('[data-hs-track-row]');
            const tr = document.querySelector('[data-hs-surface="timeline"]');
            const rr = row.getBoundingClientRect();
            const t = tr.getBoundingClientRect();
            return {
                clips: (st.clips || []).length,
                from: { x: px, y: py },
                to: { x: Math.round(t.left + t.width * 0.5), y: Math.round(rr.top + rr.height * 0.6) },
            };
        },
        previewInfo.x,
        previewInfo.y,
    );

    // 真触摸：按住 320ms（长按成立）→ 分步移动 → 松手
    await cdp.call(() => {
        window.__hsDragSeen = [];
        window.addEventListener('hifi-file-drag', (e) => window.__hsDragSeen.push(String(e.detail?.type)));
    });
    await touch('touchStart', [{ id: 0, x: before.from.x, y: before.from.y }]);
    await sleep(340);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
        const x = before.from.x + ((before.to.x - before.from.x) * i) / steps;
        const y = before.from.y + ((before.to.y - before.from.y) * i) / steps;
        await touch('touchMove', [{ id: 0, x: Math.round(x), y: Math.round(y) }]);
        await sleep(45);
    }
    await touch('touchEnd', []);
    await sleep(2600);
    const seq = await cdp.call(() => window.__hsDragSeen || []);
    console.log('▸ 长按拖拽事件序列：' + JSON.stringify(seq));
    check(
        '②-a **长按 320ms 后拖动** ⇒ 拖拽真的起来（发 start，且不再被滚动掐掉）',
        seq.includes('start'),
        `事件序列=${JSON.stringify(seq)}`,
    );

    let after = { clips: before.clips };
    for (let i = 0; i < 12; i++) {
        after = await cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
            return { clips: (st.clips || []).length };
        });
        if (after.clips > before.clips) break;
        await sleep(1000);
    }
    check(
        '②-b 放手后轨道上多出一个块（跨界面拖动成功）',
        after.clips > before.clips,
        `块数 ${before.clips} → ${after.clips}`,
    );

    // ── ②-c 反例：落指立即快划 ⇒ 不该触发拖拽（应让列表滚动）───────
    await cdp.call(() => {
        window.__hsDragSeen = [];
    });
    await touch('touchStart', [{ id: 0, x: before.from.x, y: before.from.y }]);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ id: 0, x: before.from.x, y: before.from.y - i * 12 }]);
        await sleep(25);
    }
    await touch('touchEnd', []);
    await sleep(900);
    const seq2 = await cdp.call(() => window.__hsDragSeen || []);
    console.log('▸ 快划事件序列：' + JSON.stringify(seq2));
    check(
        '②-c 反例：落指即快划**不**触发拖拽（保留列表滚动）',
        !seq2.includes('start'),
        `事件序列=${JSON.stringify(seq2)}（期望为空）`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
