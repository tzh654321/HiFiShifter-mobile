#!/usr/bin/env node
/**
 * E19a 验证 v5：完整链路 —— **先用绘制工具画一段 → 切「还原」→ 在同区间拖动擦除** → 比对参数。
 *
 * 为什么必须这样：`get_param_frames` 在空轨道上返回 0 帧，直接测"还原"得到 Δ0 无法判读。
 *
 * 用法：node scripts\_probe-e19a5.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

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
    const menuItems = () =>
        cdp.call(() =>
            [...document.querySelectorAll('button,[role=menuitem]')]
                .filter((x) => /^(绘制|颤音|还原)$/.test((x.textContent || '').trim()))
                .map((x) => {
                    const r = x.getBoundingClientRect();
                    return { text: (x.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }),
        );
    /** 长按绘制按钮 → 选某个工具。 */
    const pickTool = async (name) => {
        const draw = await cdp.call(() => {
            const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]') ?? document;
            const el = [...bar.querySelectorAll('button')].find((x) => /绘制/.test((x.getAttribute('data-tooltip') || '') + (x.getAttribute('aria-label') || '')));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!draw) return false;
        await touch('touchStart', [{ id: 0, x: draw.x, y: draw.y }]);
        for (let i = 0; i < 6; i++) {
            await sleep(90);
            await touch('touchMove', [{ id: 0, x: draw.x, y: draw.y }]);
        }
        await sleep(120);
        await touch('touchEnd', []);
        await sleep(1000);
        const items = await menuItems();
        const target = items.find((i) => i.text === name);
        if (!target) return false;
        await touch('touchStart', [{ id: 0, x: target.x, y: target.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1000);
        return true;
    };
    const readParam = () =>
        cdp.call(async () => {
            const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 80) }));
            const st = await inv('get_timeline_state', {});
            const trackId = (st?.tracks || [])[0]?.id ?? 'track_main';
            const res = await inv('get_param_frames', { trackId, param: 'pitch', startFrame: 0, frameCount: 8000, stride: 8, binary: false });
            if (res?.err) return { err: res.err };
            const edit = res?.edit ?? [];
            const idxs = [];
            edit.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v) && v !== 0) idxs.push(i); });
            return { total: edit.length, nonZero: idxs.length, first: idxs[0] ?? null, last: idxs[idxs.length - 1] ?? null };
        });

    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 80).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (!canvas) { cdp.close(); return; }

    /** 在画布上划一条线。 */
    const stroke = async (yOffset, n = 18, stepPx = 10) => {
        const x0 = canvas.x + 25;
        const y0 = canvas.y + Math.round(canvas.h * 0.45) + yOffset;
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(120);
        for (let i = 1; i <= n; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * stepPx, y: y0 + Math.round(Math.sin(i / 2) * 9) }]);
            await sleep(60);
        }
        await touch('touchEnd', []);
        await sleep(1600);
    };

    // ① 用「绘制」画一段
    const okDraw = await pickTool('绘制');
    console.log('切到「绘制」：' + okDraw);
    await stroke(0);
    const afterDraw = await readParam();
    console.log('绘制后：' + JSON.stringify(afterDraw));
    check('E19a-0 绘制能写入参数（基线非空）', (afterDraw.nonZero ?? 0) > 0, JSON.stringify(afterDraw));

    // ② 切「还原」并在同区间拖动擦除
    const okRestore = await pickTool('还原');
    console.log('切到「还原」：' + okRestore);
    await stroke(0);
    const afterRestore = await readParam();
    console.log('还原后：' + JSON.stringify(afterRestore));
    const delta = (afterDraw.nonZero ?? 0) - (afterRestore.nonZero ?? 0);
    check('E19a-2 「还原」拖动能连续擦除（非零帧显著减少）', delta > 3, `非零帧 ${afterDraw.nonZero} → ${afterRestore.nonZero}（Δ${delta}）`);
    console.log('（Δ ≤ 3 ⇒ 只擦掉一个点，即用户报的"只能点一个点"）');
    cdp.close();
};

await main();
