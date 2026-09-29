#!/usr/bin/env node
/**
 * E19a 验证 v6：用**后端命令写基线**（绕开绘制工具的不稳定），再切「还原」拖动擦除。
 *
 *   ① `set_param_frames(trackId,"pitch",0,values)` 写入一段非零基线；
 *   ② 读回确认基线非空；
 *   ③ 长按绘制按钮（带周期零位移 move）→ 选「还原」；
 *   ④ 在参数画布上拖动；
 *   ⑤ 读回：非零帧显著减少 ⇒ 拖动生效；只掉 1~3 帧 ⇒ 复现"只能点一个点"。
 *
 * 用法：node scripts\_probe-e19a6.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const FRAMES = 2000;

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

    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2400));
    });

    // ① 写基线：一段正弦（避免全 0 ⇒ 还原才有可擦的东西）
    const values = Array.from({ length: FRAMES }, (_, i) => Math.sin(i / 40) * 300);
    const w = await invoke('set_param_frames', { trackId: 'track_main', param: 'pitch', startFrame: 0, values, checkpoint: false });
    console.log('写基线：' + JSON.stringify(w).slice(0, 120));

    const readParam = async () => {
        const res = await invoke('get_param_frames', { trackId: 'track_main', param: 'pitch', startFrame: 0, frameCount: FRAMES, stride: 1, binary: false });
        if (res?.err) return { err: res.err };
        const keys = res ? Object.keys(res) : [];
        const arr = res?.edit ?? res?.values ?? res?.orig ?? [];
        const nz = arr.filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0).length;
        return { keys, len: arr.length, nonZero: nz, sample: arr.slice(0, 4) };
    };
    const base = await readParam();
    console.log('基线：' + JSON.stringify(base));
    check('E19a-0 基线写入成功（非零帧 > 100）', (base.nonZero ?? 0) > 100, JSON.stringify(base));

    // ③ 切「还原」
    const draw = await cdp.call(() => {
        const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]') ?? document;
        const el = [...bar.querySelectorAll('button')].find((x) => /绘制/.test((x.getAttribute('data-tooltip') || '') + (x.getAttribute('aria-label') || '')));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    let restoreAt = null;
    if (draw) {
        await touch('touchStart', [{ id: 0, x: draw.x, y: draw.y }]);
        for (let i = 0; i < 6; i++) { await sleep(90); await touch('touchMove', [{ id: 0, x: draw.x, y: draw.y }]); }
        await sleep(120);
        await touch('touchEnd', []);
        await sleep(1200);
        restoreAt = await cdp.call(() => {
            const el = [...document.querySelectorAll('button,[role=menuitem]')].find((x) => (x.textContent || '').trim() === '还原');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
    }
    console.log('「还原」项：' + JSON.stringify(restoreAt));
    check('E19a-1 能打开工具菜单并找到「还原」', Boolean(restoreAt), JSON.stringify(restoreAt));
    if (restoreAt) {
        await touch('touchStart', [{ id: 0, x: restoreAt.x, y: restoreAt.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1200);
    }

    // ④ 在参数画布上拖动（覆盖基线所在的横向区间）
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
        await sleep(1800);
        console.log('已拖动约 240px（24 次 move）');
    }
    const after = await readParam();
    console.log('拖动后：' + JSON.stringify(after));
    const delta = (base.nonZero ?? 0) - (after.nonZero ?? 0);
    check(
        'E19a-2 「还原」拖动可**连续擦除**（非零帧大幅减少）',
        delta > 10,
        `非零帧 ${base.nonZero} → ${after.nonZero}（Δ${delta}）；若 Δ 只有 1~3 ⇒ 复现"只能点一个点"`,
    );
    cdp.close();
};

await main();
