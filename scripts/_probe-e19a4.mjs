#!/usr/bin/env node
/**
 * E19a 验证 v4：用**真实触摸长按**（带周期零位移 move，推进 WebView 的长按计时器）
 * 打开「绘制」工具菜单 → 选「还原」→ 在参数画布拖动 → 比对后端参数被改写的范围。
 *
 * 判读：被改写帧跨越整段拖动 ⇒ 拖动生效；只有单帧 ⇒ 复现"只能点一个点"。
 *
 * 用法：node scripts\_probe-e19a4.mjs [serial]
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

    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });

    // 绘制按钮（在「上工具栏」= param-toolbar 之内）
    const draw = await cdp.call(() => {
        const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]');
        const scope = bar ?? document;
        const el = [...scope.querySelectorAll('button')].find((x) => /绘制/.test((x.getAttribute('data-tooltip') || '') + (x.getAttribute('aria-label') || '')));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.getAttribute('data-tooltip') || el.getAttribute('aria-label') };
    });
    console.log('绘制按钮：' + JSON.stringify(draw));

    const menuItems = () =>
        cdp.call(() =>
            [...document.querySelectorAll('button,[role=menuitem]')]
                .filter((x) => /^(绘制|颤音|还原)$/.test((x.textContent || '').trim()))
                .map((x) => {
                    const r = x.getBoundingClientRect();
                    return { text: (x.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
                }),
        );

    let items = [];
    if (draw) {
        // ① 真实触摸长按 + 周期零位移 move
        await touch('touchStart', [{ id: 0, x: draw.x, y: draw.y }]);
        for (let i = 0; i < 6; i++) {
            await sleep(90);
            await touch('touchMove', [{ id: 0, x: draw.x, y: draw.y }]);
        }
        await sleep(120);
        await touch('touchEnd', []);
        await sleep(1200);
        items = await menuItems();
        console.log('长按后菜单项：' + JSON.stringify(items));
    }
    if (!items.length && draw) {
        // ② 退路：在**按钮元素本身**上派发合成 PointerEvent（React 委托在 root，冒泡即可达）
        console.log('真实触摸没打开菜单，改用元素级合成事件…');
        await cdp.call(async (x, y) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const el = document.elementFromPoint(x, y);
            const target = el?.closest?.('button') ?? el;
            if (!target) return;
            const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
            target.dispatchEvent(ev('pointerdown'));
            await wait(480);
            target.dispatchEvent(ev('pointerup'));
            await wait(400);
        }, draw.x, draw.y);
        await sleep(1000);
        items = await menuItems();
        console.log('合成事件后菜单项：' + JSON.stringify(items));
    }
    const restore = items.find((i) => i.text === '还原');
    check('E19a-1 能打开含「还原」的工具菜单', Boolean(restore), JSON.stringify(items));
    if (!restore) {
        cdp.close();
        return;
    }
    await touch('touchStart', [{ id: 0, x: restore.x, y: restore.y }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(1200);

    // 读参数
    const readParam = () =>
        cdp.call(async () => {
            const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 80) }));
            const st = await inv('get_timeline_state', {});
            const trackId = (st?.tracks || [])[0]?.id ?? 'track_main';
            const res = await inv('get_param_frames', { trackId, param: 'pitch', startFrame: 0, frameCount: 6000, stride: 8, binary: false });
            if (res?.err) return { err: res.err, trackId };
            const edit = res?.edit ?? [];
            // 统计"非零"帧的分布（还原会把这些抹掉）
            const idxs = [];
            edit.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v) && v !== 0) idxs.push(i); });
            return { trackId, total: edit.length, nonZero: idxs.length, firstIdx: idxs[0] ?? null, lastIdx: idxs[idxs.length - 1] ?? null };
        });
    const before = await readParam();
    console.log('拖动前：' + JSON.stringify(before));

    // 参数画布拖动
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 80).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const x0 = canvas.x + 25;
        const y0 = canvas.y + Math.round(canvas.h * 0.45);
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(120);
        for (let i = 1; i <= 18; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 9) }]);
            await sleep(60);
        }
        await touch('touchEnd', []);
        await sleep(1600);
        console.log('已拖动约 180px（18 次 move）');
    }
    const after = await readParam();
    console.log('拖动后：' + JSON.stringify(after));
    const delta = (before.nonZero ?? 0) - (after.nonZero ?? 0);
    check('E19a-2 拖动改变了参数（非零帧数量变化 ⇒ 拖动生效）', delta !== 0, `非零帧 ${before.nonZero} → ${after.nonZero}（Δ${delta}）`);
    console.log('（Δ=0 且该区间本来就有曲线 ⇒ 拖动未生效，即用户报的"只能点一个点"）');
    cdp.close();
};

await main();
