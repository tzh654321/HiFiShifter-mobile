#!/usr/bin/env node
/**
 * 一次性诊断：真机上「内核收不收到 pointer 事件」+「setTouchEmulationEnabled 有没有副作用」。
 * 用法：node scripts/_dbg-touch-real.mjs [serial] [--no-emul]
 */
import { execSync } from 'node:child_process';
import { Cdp } from '../scripts/lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const noEmul = process.argv.includes('--no-emul');

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    if (!noEmul) {
        try {
            await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        } catch {
            /* ignore */
        }
    }
    console.log(`▸ touchEmulation=${noEmul ? '关闭' : '开启'}`);

    await cdp.call(() => {
        window.__evLog = [];
        const surface = document.querySelector('[data-hs-surface="timeline"]') ?? document.body;
        const log = (e) => {
            if (window.__evLog.length > 40) return;
            const t = e.touches && e.touches[0];
            window.__evLog.push({
                type: e.type,
                pt: e.pointerType ?? null,
                x: e.clientX !== undefined ? Math.round(e.clientX) : t ? Math.round(t.clientX) : null,
                y: e.clientY !== undefined ? Math.round(e.clientY) : t ? Math.round(t.clientY) : null,
                button: e.button ?? null,
            });
        };
        for (const ty of [
            'pointerdown',
            'pointermove',
            'pointerup',
            'pointercancel',
            'touchstart',
            'touchmove',
            'touchend',
            'touchcancel',
        ]) {
            surface.addEventListener(ty, log, { passive: true, capture: true });
        }
        window.__evDump = () => window.__evLog.slice();
    });

    const env = await cdp.call(() => ({ vp: window.__hsViewport(), maxTouch: navigator.maxTouchPoints }));
    const c = env.vp.containerRect;
    const x = Math.round(c.left + 40);
    const y = Math.round(c.top + Math.round(env.vp.rowHeight * 0.65));
    console.log(`▸ 容器 ${JSON.stringify(c)} rowHeight=${env.vp.rowHeight} maxTouchPoints=${env.maxTouch}`);
    console.log(`▸ 派发触摸到 (${x},${y})，按住 700ms 后移动 30px`);
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(700);
    const hint = await cdp.call(() => {
        const el = document.querySelector('[data-hs-edge-longpress-hint]');
        return el ? el.getAttribute('data-hs-edge-side') : null;
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 0, x: x - 40, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    console.log('▸ 长按提示=' + hint);
    console.log('▸ 事件序列：' + JSON.stringify(await cdp.call(() => window.__evDump())));
    cdp.close();
};

await main();
