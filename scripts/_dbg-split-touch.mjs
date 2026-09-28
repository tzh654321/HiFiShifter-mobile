#!/usr/bin/env node
/** 临时：CDP 触摸到底有没有变成页面内的 pointer 事件（C5/C6 探针拖不动时用的取证）。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] || 'emulator-5554';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

await cdp.call(() => {
    const log = [];
    window.__hsTouchLog = log;
    const push = (e) => {
        const t = e.target;
        log.push({
            t: e.type,
            pt: e.pointerType,
            id: e.pointerId,
            x: Math.round(e.clientX),
            y: Math.round(e.clientY),
            tg: t && t.tagName ? t.tagName + '.' + String(t.className).slice(0, 26) : String(t),
        });
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend']) {
        document.addEventListener(t, push, true);
    }
    return true;
});

const r = await cdp.call(() => {
    const el = document.querySelector('[data-hs-time-ruler="params"]');
    const c = document.querySelector('[data-hs-mobile-split]');
    if (!el || !c) return { err: 'missing', ruler: !!el, cont: !!c };
    const b = el.getBoundingClientRect();
    const cb = c.getBoundingClientRect();
    return {
        x: Math.round(b.left + 40),
        y0: Math.round(b.top + 8),
        y1: Math.round(cb.top + 0.35 * cb.height),
        rulerY: Math.round(b.top),
        rulerH: Math.round(b.height),
        ratioBefore: +(((c.children[1].getBoundingClientRect().top - cb.top) / cb.height).toFixed(3)),
    };
});
console.log('▸ 目标：' + JSON.stringify(r));

const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
    });

await touch('touchStart', [{ x: r.x, y: r.y0 }]);
await sleep(80);
for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: r.x, y: Math.round(r.y0 + ((r.y1 - r.y0) * i) / 6) }]);
    await sleep(45);
}
await touch('touchEnd', []);
await sleep(700);

const out = await cdp.call(() => {
    const c = document.querySelector('[data-hs-mobile-split]');
    const cb = c.getBoundingClientRect();
    return {
        ratioAfter: +(((c.children[1].getBoundingClientRect().top - cb.top) / cb.height).toFixed(3)),
        events: (window.__hsTouchLog || []).slice(0, 24),
        total: (window.__hsTouchLog || []).length,
    };
});
console.log('▸ 结果：ratioAfter=' + out.ratioAfter + '  事件数=' + out.total);
console.log(JSON.stringify(out.events, null, 1));
cdp.close();
