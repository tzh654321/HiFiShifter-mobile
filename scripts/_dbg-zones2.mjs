#!/usr/bin/env node
/**
 * 逐点扫描：容器内每个 y 的**命中分区**（用内核自己写的 inline cursor 读）。
 * 同时打印内核容器与面板容器是否同一个元素、以及块的推算矩形。
 *
 * 用法：node scripts/_dbg-zones2.mjs [serial]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';
const WAV = 'D:\\Temp\\hs-tone.wav';

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
    await sleep(900);
    await cdp.call((b) => window.__hsImportAudioBase64('z2.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1400);

    const g = await cdp.call(() => {
        const vp = window.__hsViewport();
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const raw = (s.clips || [])[0];
            const tracks = s.tracks || [];
            const c = vp.containerRect;
            const kernel = [...document.querySelectorAll('div')].find((e) =>
                String(e.className).includes('bg-qt-graph-bg'),
            );
            const kr = kernel ? kernel.getBoundingClientRect() : null;
            return {
                rowIndex: tracks.findIndex((t) => t.id === raw.track_id),
                tracks: tracks.length,
                rowHeight: vp.rowHeight,
                pxPerSec: vp.pxPerSec,
                scrollTop: vp.scrollTop,
                scrollLeft: vp.scrollLeft,
                container: c,
                kernelRect: kr
                    ? { left: Math.round(kr.left), top: Math.round(kr.top), width: Math.round(kr.width), height: Math.round(kr.height) }
                    : null,
                clipLeft: c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft,
                clipTop: c.top + tracks.findIndex((t) => t.id === raw.track_id) * vp.rowHeight - vp.scrollTop,
            };
        });
    });
    console.log(
        `▸ 容器=${JSON.stringify(g.container)} 内核容器=${JSON.stringify(g.kernelRect)} 行高=${g.rowHeight} 块行=${g.rowIndex} 块顶(推算)=${Math.round(g.clipTop)} 块左=${Math.round(g.clipLeft)}`,
    );

    const x = Math.round(g.clipLeft + 3);
    const top = Math.round(g.container.top);
    const bottom = Math.round(g.container.top + g.container.height);
    const rows = [];
    for (let y = top; y <= bottom - 2; y += 6) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await sleep(45);
        const cur = await cdp.call(() => {
            const el = [...document.querySelectorAll('div')].find(
                (e) => String(e.className).includes('bg-qt-graph-bg') && e.style.cursor && e.style.cursor !== '',
            );
            return el ? el.style.cursor : null;
        });
        const zone =
            cur === 'nwse-resize'
                ? '淡入角'
                : cur === 'nesw-resize'
                  ? '淡出角'
                  : cur === 'ew-resize'
                    ? '边缘/Snap'
                    : cur === 'col-resize'
                      ? '边缘(拉伸键)'
                      : 'body/header/空白';
        rows.push({ y, rel: y - top, cur, zone });
        console.log(`  y=${y} (容器内 +${String(y - top).padStart(3)}) cursor=${String(cur).padEnd(12)} ⇒ ${zone}`);
    }
    cdp.close();
};

await main();
