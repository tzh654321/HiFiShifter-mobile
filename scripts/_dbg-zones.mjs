#!/usr/bin/env node
/**
 * 一次性诊断：沿「块左缘内侧 3px」扫 y，逐点读两样东西——
 *   ① `document.elementFromPoint` 命中的元素（看事件到底落在谁身上）；
 *   ② **内核容器**的 inline `style.cursor`（`nwse-resize` = 淡入角、`ew-resize` =
 *      边缘、空 = body/header）。内核容器由 `class` 里含 `bg-qt-graph-bg` 且
 *      带 inline cursor 的 DIV 认出（用「第一个带 cursor 的元素」会误抓别的按钮）。
 *
 * 用法：node scripts/_dbg-zones.mjs --serial emulator-5554
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv.includes('--serial')
    ? process.argv[process.argv.indexOf('--serial') + 1]
    : 'emulator-5554';
const WAV = 'D:\\Temp\\hs-tone.wav';

function geometry() {
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((state) => {
        const vp = window.__hsViewport();
        const raw = (state.clips || [])[0] ?? null;
        const c = vp.containerRect;
        return {
            clips: (state.clips || []).length,
            clip: raw ? { startSec: raw.start_sec, lengthSec: raw.length_sec, fadeInSec: raw.fade_in_sec ?? 0 } : null,
            rowHeight: vp.rowHeight,
            pxPerSec: vp.pxPerSec,
            clipLeft: c.left + (raw ? raw.start_sec * vp.pxPerSec - vp.scrollLeft : 0),
            clipTop: c.top - vp.scrollTop,
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
    await cdp.call((b) => window.__hsImportAudioBase64('zone.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1300);

    const g = await cdp.call(geometry);
    const x = Math.round(g.clipLeft + 3);
    const top = Math.round(g.clipTop);
    console.log(`▸ 块左缘 x=${Math.round(g.clipLeft)} 块顶 y=${top} 行高=${g.rowHeight.toFixed(1)} pxPerSec=${g.pxPerSec.toFixed(1)}`);

    const readZone = (px, py) =>
        cdp.call(
            (ax, ay) => {
                const el = document.elementFromPoint(ax, ay);
                const kernel = [...document.querySelectorAll('div')].find(
                    (e) => String(e.className).includes('bg-qt-graph-bg') && e.style.cursor !== undefined,
                );
                return {
                    at: el ? el.tagName + '.' + String(el.className).slice(0, 40) : null,
                    cursor: kernel ? kernel.style.cursor : '(no-kernel)',
                };
            },
            px,
            py,
        );

    for (let localY = 0; localY <= Math.round(g.rowHeight) - 4; localY += 6) {
        const y = top + localY;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await sleep(50);
        const r = await readZone(x, y);
        const zone =
            r.cursor === 'nwse-resize'
                ? '淡入角'
                : r.cursor === 'nesw-resize'
                  ? '淡出角'
                  : r.cursor === 'ew-resize'
                    ? '边缘/SnapOffset'
                    : 'body/header';
        console.log(`  +${String(localY).padStart(3)} y=${y} 元素=${String(r.at).padEnd(46)} cursor=${String(r.cursor).padEnd(12)} ⇒ ${zone}`);
    }
    cdp.close();
};

await main();
