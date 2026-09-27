#!/usr/bin/env node
/** 一次性诊断：真机上「块右缘控制点那个点到底被谁接住」。 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
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
    await cdp.call((b) => window.__hsImportAudioBase64('diag.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1400);

    const g = await cdp.call(() => {
        const vp = window.__hsViewport();
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const raw = (s.clips || [])[0];
            const tracks = s.tracks || [];
            const rowIndex = tracks.findIndex((t) => t.id === raw.track_id);
            const c = vp.containerRect;
            const clipHeight = Math.max(1, vp.rowHeight - 2);
            const header = 18;
            const body = Math.max(1, clipHeight - header);
            const reserve = Math.max(14, Math.round(body / 3));
            const localY = Math.round((header + reserve + Math.max(header + reserve + 1, clipHeight - 12)) / 2);
            return {
                rowIndex,
                tracks: tracks.length,
                rowHeight: vp.rowHeight,
                pxPerSec: vp.pxPerSec,
                container: c,
                clipTop: c.top + rowIndex * vp.rowHeight - vp.scrollTop,
                clipLeft: c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft,
                clipRight: c.left + (raw.start_sec + raw.length_sec) * vp.pxPerSec - vp.scrollLeft,
                localY,
                bands: { header, reserve, edgeBand: [header + reserve, clipHeight - 12] },
            };
        });
    });
    console.log('▸ 几何：' + JSON.stringify(g));

    const pts = [
        ['尾控制点', Math.round(g.clipRight - 5), Math.round(g.clipTop + g.localY)],
        ['头控制点', Math.round(g.clipLeft + 5), Math.round(g.clipTop + g.localY)],
        ['淡变区竖条', Math.round(g.clipLeft + 3), Math.round(g.clipTop + 18 + Math.round(g.bands.reserve / 2))],
    ];
    for (const [name, x, y] of pts) {
        const info = await cdp.call(
            (ax, ay) => {
                const el = document.elementFromPoint(ax, ay);
                const r = el ? el.getBoundingClientRect() : null;
                const bar = document.querySelector('[data-hs-clip-actions] > div');
                const br = bar ? bar.getBoundingClientRect() : null;
                return {
                    at: el ? el.tagName + '.' + String(el.className).slice(0, 50) : null,
                    attrs: el ? [...el.attributes].map((a) => a.name).slice(0, 5) : [],
                    rect: r ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : null,
                    barRect: br ? `${Math.round(br.left)},${Math.round(br.top)} ${Math.round(br.width)}x${Math.round(br.height)}` : null,
                };
            },
            x,
            y,
        );
        console.log(`▸ ${name} (${x},${y}) → ${JSON.stringify(info)}`);
    }
    cdp.close();
};

await main();
