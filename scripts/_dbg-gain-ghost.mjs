#!/usr/bin/env node
/**
 * E-GAIN 幽灵拖动判定：**单次轻点旋钮**（不拖）之后，别处的纵向移动是否还会改增益。
 *
 * 依据：`_dbg-gain-seq.mjs` 里两次拖动（按 420ms 与按 120ms）算出来的终值都精确等于
 * `(149 − 终点y) × 0.2` —— 而 149 正是**复位时旋钮中心**、0dB 正是**复位后的音量**
 * ⇒ 有个**更早的拖动**一直活着，在替后续每次手势算增益。
 * `beginVolumeKnobDrag` 的门槛定时器若没被 `onGateUp` 清掉，就会在手指抬起**之后**
 * 才 `startVolumeKnobDragNow(...)` ⇒ 注册一堆 window 监听却没有手指 ⇒ 幽灵拖动。
 *
 * 用法：node scripts/_dbg-gain-ghost.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
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
            touchPoints: pts.map((p) => ({ id: p.id ?? 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const vol = () =>
        cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {}).catch(() => null);
            return st?.tracks?.[0]?.volume ?? null;
        });
    const db = (v) => (v == null ? 'null' : (20 * Math.log10(Math.max(1e-9, v))).toFixed(2) + 'dB');

    const geo = await cdp.call(() => {
        const k = document.querySelector('[data-track-volume-knob]');
        const r = k.getBoundingClientRect();
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        const tr = tl.getBoundingClientRect();
        return {
            knob: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
            timeline: { x: Math.round(tr.left + tr.width / 2), y: Math.round(tr.top + 120) },
        };
    });

    /** 双击旋钮 = 复位到 0dB（E15）。两次轻点之间要够快（<320ms）。 */
    const resetGain = async () => {
        for (let i = 0; i < 2; i++) {
            await touch('touchStart', [{ x: geo.knob.x, y: geo.knob.y }]);
            await sleep(50);
            await touch('touchEnd', []);
            await sleep(80);
        }
        await sleep(900);
    };

    await resetGain();
    console.log('▸ 复位后 volume=' + db(await vol()));

    /* 装带时间戳的轨迹 */
    await cdp.call(() => {
        window.__gh = [];
        const t0 = performance.now();
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            window.addEventListener(t, (e) => window.__gh.push({ t, ms: Math.round(performance.now() - t0), y: Math.round(e.clientY || 0), id: e.pointerId }), true);
        }
        return true;
    });

    /* ① 单次轻点旋钮（60ms，远小于 260ms 门槛），然后等 600ms 让门槛定时器有机会开火 */
    await touch('touchStart', [{ x: geo.knob.x, y: geo.knob.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(600);
    const afterTap = await vol();
    console.log('① 轻点旋钮后 volume=' + db(afterTap) + '（应仍 0dB）');

    /* ② 在**别处**做一次纵向移动（不碰旋钮）——若幽灵拖动还活着，增益会跟着变 */
    await touch('touchStart', [{ x: geo.timeline.x, y: geo.timeline.y }]);
    await sleep(50);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ x: geo.timeline.x, y: geo.timeline.y - i * 20 }]);
        await sleep(45);
    }
    await touch('touchEnd', []);
    await sleep(1000);
    const afterAwayDrag = await vol();
    console.log('② 别处纵向拖 80px 后 volume=' + db(afterAwayDrag) + '（应仍 0dB；若 ≈ −16dB 或其它值 ⇒ 幽灵拖动）');

    const trace = await cdp.call(() => window.__gh || []);
    console.log('\n▸ 事件轨迹（前 40 条）：');
    for (const e of trace.slice(0, 40)) {
        console.log(`   ${String(e.ms).padStart(6)}ms  ${e.t.padEnd(14)} id=${String(e.id).padStart(4)} y=${e.y}`);
    }
    const cancel = trace.filter((e) => e.t === 'pointercancel').length;
    const up = trace.filter((e) => e.t === 'pointerup').length;
    console.log(`\n▸ pointerup=${up}  pointercancel=${cancel}`);
    console.log('判读：轻点若**没有** pointerup/pointercancel 到达页面，门槛定时器就不会被清掉 ⇒ 手势在抬手之后才被武装。');
    cdp.close();
};

await main();
