#!/usr/bin/env node
/**
 * 手机时间轴「选中块 + 常用操作条」的外观证据：造一个块、点选它、截屏。
 *
 * 目的：确认浮条**不再压住块的淡入淡出区**（首行块会把浮条停到容器底部），
 * 并且横向不溢出时间线容器（不压轨道头列）。
 *
 * 用法：node scripts\_shot-quickactions.mjs --serial emulator-5554 --out docs\evidence\x.png
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : dflt;
};
const serial = arg('serial', 'emulator-5554');
const out = arg('out', 'docs\\evidence\\quickactions.png');
const WAV = 'D:\\Temp\\hs-tone.wav';

function geom() {
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((state) => {
        const vp = window.__hsViewport();
        const raw = (state.clips || [])[0] ?? null;
        const c = vp.containerRect;
        return {
            clips: (state.clips || []).length,
            container: c,
            clip: raw
                ? {
                      left: c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft,
                      top: c.top - vp.scrollTop,
                      width: Math.max(24, raw.length_sec * vp.pxPerSec),
                      rowHeight: vp.rowHeight,
                  }
                : null,
        };
    });
}

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(800);
    await cdp.call((b) => window.__hsImportAudioBase64('shot.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1400);

    const g = await cdp.call(geom);
    const y = Math.round(g.clip.top + g.clip.rowHeight * 0.6);
    const x = Math.round(Math.min(g.clip.left + g.clip.width - 20, g.clip.left + 60));
    // 轻点选中（触摸）
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);

    const bar = await cdp.call(() => {
        const el = document.querySelector('[data-hs-clip-actions]');
        if (!el) return null;
        const row = el.querySelector('div');
        const r = row ? row.getBoundingClientRect() : null;
        return {
            barRect: r ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
            buttons: [...el.querySelectorAll('button')].map((b) => b.ariaLabel),
        };
    });
    console.log('▸ 浮条：' + JSON.stringify(bar));
    console.log('▸ 容器：' + JSON.stringify(g.container) + ' 块：' + JSON.stringify(g.clip));
    if (bar?.barRect) {
        const [c] = [g.container];
        const insideX = bar.barRect.left >= Math.floor(c.left) && bar.barRect.left + bar.barRect.width <= Math.ceil(c.left + c.width);
        const overlapsClipTop =
            bar.barRect.top < g.clip.top + 63 && bar.barRect.top + bar.barRect.height > g.clip.top;
        console.log(
            `▸ 判定：横向在容器内=${insideX}；纵向是否压住块的淡变区(y∈[块顶,块顶+63])=${overlapsClipTop}`,
        );
    }
    execSync(`adb -s ${serial} shell screencap -p /sdcard/hs-shot.png`);
    execSync(`adb -s ${serial} pull /sdcard/hs-shot.png "${out}"`, { stdio: 'ignore' });
    console.log('▸ 截图：' + out);
    cdp.close();
};

await main();
