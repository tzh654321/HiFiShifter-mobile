#!/usr/bin/env node
/**
 * 真机几何事实：容器 / 内核容器 / 行高 / 轨道的父子关系 / scrollTop / 块推算矩形。
 * 用于解释「真机上按推算的块内坐标却命不中块」。
 *
 * 用法：node scripts/_dbg-realgeo.mjs [serial]
 */
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

    const before = await cdp.call(() => {
        const vp = window.__hsViewport();
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => ({
            vp: { rowHeight: vp.rowHeight, scrollTop: vp.scrollTop, scrollLeft: vp.scrollLeft, pxPerSec: vp.pxPerSec, container: vp.containerRect },
            tracks: (s.tracks || []).map((t) => ({ id: t.id, parent: t.parent_id, depth: t.depth, children: (t.child_track_ids || []).length })),
            clips: (s.clips || []).map((c) => ({ id: c.id, track: c.track_id, start: c.start_sec, len: c.length_sec })),
            sel: s.selected_clip_id,
        }));
    });
    console.log('▸ 现状：' + JSON.stringify(before, null, 1));

    // 造一个块到「第一条轨道」，再看渲染容器
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(900);
    await cdp.call((b) => window.__hsImportAudioBase64('rg.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1500);

    const after = await cdp.call(() => {
        const vp = window.__hsViewport();
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const trackIds = (s.tracks || []).map((t) => t.id);
            const raw = (s.clips || [])[0];
            const kernel = [...document.querySelectorAll('div')].find((e) => String(e.className).includes('bg-qt-graph-bg'));
            const kr = kernel ? kernel.getBoundingClientRect() : null;
            const cr = vp.containerRect;
            return {
                vp: { rowHeight: vp.rowHeight, scrollTop: vp.scrollTop, scrollLeft: vp.scrollLeft, pxPerSec: vp.pxPerSec, container: cr },
                kernelRect: kr ? { left: Math.round(kr.left), top: Math.round(kr.top), w: Math.round(kr.width), h: Math.round(kr.height) } : null,
                sameAsPanel: kr ? Math.abs(kr.top - cr.top) < 0.5 && Math.abs(kr.left - cr.left) < 0.5 : null,
                sameSize: kr ? Math.abs(kr.height - cr.height) < 0.5 : null,
                trackOrder: trackIds,
                clipRow: trackIds.indexOf(raw.track_id),
                clipTrackId: raw.track_id,
                predictedTop: cr.top + trackIds.indexOf(raw.track_id) * vp.rowHeight - vp.scrollTop,
                predictedLeft: cr.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft,
                clipVisibleRows: Math.floor(cr.height / vp.rowHeight),
            };
        });
    });
    console.log('▸ 导入后：' + JSON.stringify(after, null, 1));
    cdp.close();
};

await main();
