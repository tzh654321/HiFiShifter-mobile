#!/usr/bin/env node
/**
 * 用临时诊断日志定位 E11-b（增益长按拖动）与 E19a（还原画笔拖动）。
 *
 * 只做**触发**，判读交给 logcat 里的 `[e11][diag]` / `[e19a][diag]`。
 *
 * 用法：node scripts\_drive-e11-e19a.mjs [serial]
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
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({
                id: p.id ?? i,
                x: Math.round(p.x),
                y: Math.round(p.y),
                radiusX: 6,
                radiusY: 6,
                force: 1,
            })),
        });

    // ── E11-b：轨道面板上长按增益旋钮并拖动 ──────────────────────
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
        await new Promise((r) => setTimeout(r, 1800));
    });
    const knob = await cdp.call(() => {
        const k = document.querySelector('[data-track-volume-knob]');
        if (!k) return null;
        const r = k.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    console.log('增益旋钮：' + JSON.stringify(knob));
    if (knob) {
        await touch('touchStart', [{ id: 0, x: knob.x, y: knob.y }]);
        await sleep(400); // 长按门槛 260ms
        for (let i = 1; i <= 8; i++) {
            await touch('touchMove', [{ id: 0, x: knob.x, y: knob.y - i * 8 }]);
            await sleep(60);
        }
        await touch('touchEnd', []);
        await sleep(800);
    }

    // ── E19a：参数面板上切到「还原」工具并拖动 ───────────────────
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await wait(2200);
    });
    // 切「还原」工具：长按绘制按钮开工具菜单，再点「还原」
    const toolBtn = await cdp.call(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /绘制|draw|铅笔/.test(x.getAttribute('data-tooltip') || x.getAttribute('aria-label') || ''));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    console.log('绘制工具按钮：' + JSON.stringify(toolBtn));
    if (toolBtn) {
        // 点一次（切到绘制）再点一次（开菜单）
        await touch('touchStart', [{ id: 0, x: toolBtn.x, y: toolBtn.y }]);
        await sleep(80);
        await touch('touchEnd', []);
        await sleep(700);
        await touch('touchStart', [{ id: 0, x: toolBtn.x, y: toolBtn.y }]);
        await sleep(80);
        await touch('touchEnd', []);
        await sleep(1200);
        const restoreItem = await cdp.call(() => {
            const el = [...document.querySelectorAll('button,div')].find((x) => /还原/.test((x.textContent || '').trim()) && x.getBoundingClientRect().height < 60);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        console.log('「还原」项：' + JSON.stringify(restoreItem));
        if (restoreItem) {
            await touch('touchStart', [{ id: 0, x: restoreItem.x, y: restoreItem.y }]);
            await sleep(80);
            await touch('touchEnd', []);
            await sleep(900);
        }
    }
    // 在参数画布上拖动（走 pointer 路径）
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 100 && c.h > 100).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const y0 = canvas.y + Math.round(canvas.h * 0.5);
        const x0 = canvas.x + 40;
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(90);
        for (let i = 1; i <= 12; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * 12, y: y0 - (i % 3) * 6 }]);
            await sleep(55);
        }
        await touch('touchEnd', []);
        await sleep(900);
    }
    console.log('已触发两个场景');
    cdp.close();
};

await main();
