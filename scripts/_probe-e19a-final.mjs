#!/usr/bin/env node
/**
 * E19a 收口验证：
 *   ① 用**前端拖拽**造块（后端命令造块不更新前端 store ⇒ 参数读取会恒空，这是上一轮定位到的前置条件）；
 *   ② 切参数面板，`set_param_frames` 写一段基线并**读回确认非零**；
 *   ③ 长按绘制按钮（真实触摸 + 周期零位移 move，带重试）→ 选「还原」；
 *   ④ 在参数画布上拖动擦除；
 *   ⑤ 读回：被擦除的帧是否**跨越整段拖动**。
 *
 * 用法：node scripts\_probe-e19a-final.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const FRAMES = 1200;

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const check = (n, ok, d) => console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });
    const invoke = (cmd, args) =>
        cdp.call((c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 120) })), cmd, args);

    // ── ① 前端拖拽造块 ──────────────────────────────────────────
    const seeded = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        const st0 = await inv('get_timeline_state', {});
        if ((st0?.clips || []).length > 0) return { before: st0.clips.length, skipped: true };
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'files' } }));
        await wait(1600);
        const row = [...document.querySelectorAll('div,li')].find((e) => {
            const t = (e.innerText || '').trim();
            return /\.(wav|mp3|flac|m4a|ogg)$/i.test(t) && e.children.length <= 4;
        });
        if (!row) return { before: 0, error: 'no-audio-row' };
        const r = row.getBoundingClientRect();
        return { before: (st0?.clips || []).length, from: { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) } };
    });
    console.log('造块准备：' + JSON.stringify(seeded));
    if (!seeded.skipped && seeded.from) {
        const target = await cdp.call(() => {
            const tl = document.querySelector('[data-hs-surface="timeline"]');
            if (!tl) return null;
            const r = tl.getBoundingClientRect();
            return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height * 0.3) };
        });
        await touch('touchStart', [{ id: 0, x: seeded.from.x, y: seeded.from.y }]);
        await sleep(360);
        if (target) {
            for (let i = 1; i <= 10; i++) {
                await touch('touchMove', [{ id: 0, x: seeded.from.x + ((target.x - seeded.from.x) * i) / 10, y: seeded.from.y + ((target.y - seeded.from.y) * i) / 10 }]);
                await sleep(40);
            }
        }
        await touch('touchEnd', []);
        await sleep(2600);
    }
    const clips = await cdp.call(async () => {
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {}).catch(() => null);
        return (st?.clips || []).length;
    });
    console.log('块数：' + clips);
    check('E19a-前置 轨道上有音频块', clips > 0, 'clips=' + clips);

    // ── ② 切参数面板 + 写基线 ──────────────────────────────────
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2600));
    });
    const values = Array.from({ length: FRAMES }, (_, i) => Math.sin(i / 30) * 250);
    const w = await invoke('set_param_frames', { trackId: 'track_main', param: 'pitch', startFrame: 0, values, checkpoint: false });
    console.log('写基线：' + JSON.stringify(w));
    const readParam = async () => {
        const res = await invoke('get_param_frames', { trackId: 'track_main', param: 'pitch', startFrame: 0, frameCount: FRAMES, stride: 1 });
        const arr = res?.edit ?? res?.orig ?? [];
        const nz = arr.filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0).length;
        return { len: arr.length, nonZero: nz, backend: res?.pitch_edit_backend_available ?? null, origLen: Array.isArray(res?.orig) ? res.orig.length : null, editLen: Array.isArray(res?.edit) ? res.edit.length : null };
    };
    const base = await readParam();
    console.log('基线：' + JSON.stringify(base));
    check('E19a-1 基线可读（非零 > 50）', (base.nonZero ?? 0) > 50, JSON.stringify(base));

    // ── ③ 长按绘制 →「还原」（带重试）──────────────────────────
    let restoreAt = null;
    for (let attempt = 1; attempt <= 3 && !restoreAt; attempt++) {
        const draw = await cdp.call(() => {
            const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]') ?? document;
            const el = [...bar.querySelectorAll('button')].find((x) => /绘制/.test((x.getAttribute('data-tooltip') || '') + (x.getAttribute('aria-label') || '')));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!draw) { await sleep(1200); continue; }
        await touch('touchStart', [{ id: 0, x: draw.x, y: draw.y }]);
        for (let i = 0; i < 6; i++) { await sleep(90); await touch('touchMove', [{ id: 0, x: draw.x, y: draw.y }]); }
        await sleep(120);
        await touch('touchEnd', []);
        await sleep(1300);
        restoreAt = await cdp.call(() => {
            const el = [...document.querySelectorAll('button,[role=menuitem]')].find((x) => (x.textContent || '').trim() === '还原');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        console.log(`  第 ${attempt} 次长按 → 「还原」=${JSON.stringify(restoreAt)}`);
        if (!restoreAt) await sleep(1500);
    }
    check('E19a-2 能打开工具菜单并选中「还原」', Boolean(restoreAt), JSON.stringify(restoreAt));
    if (restoreAt) {
        await touch('touchStart', [{ id: 0, x: restoreAt.x, y: restoreAt.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1400);
    }

    // ── ④ 在参数画布上拖动 ────────────────────────────────────
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 80).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const x0 = canvas.x + 20;
        const y0 = canvas.y + Math.round(canvas.h * 0.5);
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(140);
        for (let i = 1; i <= 24; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 10) }]);
            await sleep(55);
        }
        await touch('touchEnd', []);
        await sleep(2000);
        console.log('已拖动约 240px');
    }
    const after = await readParam();
    console.log('拖动后：' + JSON.stringify(after));
    const delta = (base.nonZero ?? 0) - (after.nonZero ?? 0);
    check('E19a-3 「还原」拖动可**连续擦除**（Δ > 10）', delta > 10, `非零帧 ${base.nonZero} → ${after.nonZero}（Δ${delta}）`);
    cdp.close();
};

await main();
