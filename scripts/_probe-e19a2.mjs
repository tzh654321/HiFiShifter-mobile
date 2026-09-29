#!/usr/bin/env node
/** E19a：长按绘制按钮 → 选「还原」→ 在参数画布拖动，观察后端参数是否被连续改写。 */
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
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });

    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });

    // 找「绘制」按钮
    const draw = await cdp.call(() => {
        const el = [...document.querySelectorAll('button')].find((x) => /绘制|draw|铅笔/.test(x.getAttribute('data-tooltip') || x.getAttribute('aria-label') || ''));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.getAttribute('data-tooltip') || el.getAttribute('aria-label') };
    });
    console.log('绘制按钮：' + JSON.stringify(draw));
    if (!draw) {
        console.log('🔴 找不到绘制按钮');
        cdp.close();
        return;
    }
    // **长按**（合成 PointerEvent，已验证有效）
    await cdp.call(async (x, y) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 91, isPrimary: true, clientX: x, clientY: y, button: 0 });
        const el = document.elementFromPoint(x, y) ?? document.body;
        el.dispatchEvent(ev("pointerdown"));
        await wait(500);
        el.dispatchEvent(ev("pointerup"));
        await wait(400);
    }, draw.x, draw.y);
    await sleep(1200);
    const menu = await cdp.call(() => {
        const els = [...document.querySelectorAll('button,[role=menuitem]')].filter((x) => /还原|颤音|绘制/.test((x.textContent || '').trim()));
        return els.map((x) => {
            const r = x.getBoundingClientRect();
            return { text: (x.textContent || '').trim().slice(0, 6), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
        });
    });
    console.log('工具菜单项：' + JSON.stringify(menu));
    const restore = menu.find((m) => m.text.includes('还原'));
    if (!restore) {
        console.log('🔴 长按后菜单里没有「还原」');
        cdp.close();
        return;
    }
    await touch('touchStart', [{ id: 0, x: restore.x, y: restore.y }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(1200);
    const cur = await cdp.call(() => {
        const el = document.querySelector('[data-hs-current-draw-tool]');
        const btns = [...document.querySelectorAll('button')].filter((b) => /还原/.test(b.textContent || '')).map((b) => ({ t: (b.textContent || '').trim().slice(0, 6), pressed: b.getAttribute('aria-pressed') }));
        return { hook: el ? el.getAttribute('data-hs-current-draw-tool') : null, btns };
    });
    console.log('切换后：' + JSON.stringify(cur));
    console.log('（若能看到 restore/选中态 ⇒ 已切到还原工具；随后拖动应连续改写后端参数）');
    cdp.close();
};

await main();
