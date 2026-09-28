#!/usr/bin/env node
/** 临时：看 `import → split` 之后后端 clip 字段的真实形状（源窗口语义）。 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] || '221deeb';
const wav = process.argv[3] || 'D:\\Temp\\hs-tone.wav';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}
const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
    });

const snap = () =>
    cdp.call(async () => {
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state');
        const v = window.__hsViewport ? window.__hsViewport() : null;
        return {
            playhead: st.playhead_sec,
            media: (st.media || st.mediaFiles || st.media_files || []).map((m) => ({
                name: (m.name || m.fileName || '').slice(0, 28),
                dur: m.durationSec ?? m.duration_sec,
            })),
            pxPerSec: v ? Math.round(v.pxPerSec) : null,
            scrollLeft: v ? Math.round(v.scrollLeft) : null,
            clips: (st.clips || [])
                .slice()
                .sort((a, b) => a.start_sec - b.start_sec)
                .map((c) => ({
                    id: c.id.slice(0, 12),
                    start: +c.start_sec.toFixed(4),
                    len: +c.length_sec.toFixed(4),
                    ss: +(c.source_start_sec ?? -1).toFixed(4),
                    se: +(c.source_end_sec ?? -1).toFixed(4),
                    rate: c.clip_playback_rate ?? c.playback_rate,
                    name: (c.name || '').slice(0, 22),
                })),
        };
    });

console.log('清空 …');
for (let g = 0; g < 6; g++) {
    const s = await cdp.call(async () => {
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state');
        return { n: (st.clips || []).length };
    });
    if (!s.n) break;
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(900);
}
console.log('空：' + JSON.stringify((await snap()).clips));

await cdp.call((n, b) => window.__hsImportAudioBase64(n, b, 0), 'hs-split-probe.wav', readFileSync(wav).toString('base64'));
await sleep(1500);
let s = await snap();
console.log('导入后：' + JSON.stringify(s, null, 1));

/* 点拍数栏 seek 到 40%（拍数栏在内核容器上方 24px 处）。 */
const g = await cdp.call(() => window.__hsViewport());
const c = g.containerRect;
const yRuler = await cdp.call(() => {
    const c2 = window.__hsViewport().containerRect;
    const r = document.querySelector('[data-hs-time-ruler="timeline"]');
    return r ? Math.round(r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) : Math.round(c2.top - 24);
});
const cut = s.clips[0].len * 0.4;
const xSeek = Math.round(c.left + cut * g.pxPerSec - g.scrollLeft);
await touch('touchStart', [{ id: 0, x: xSeek, y: yRuler }]);
await sleep(60);
await touch('touchEnd', []);
await sleep(600);
console.log(`seek 目标 ${cut.toFixed(3)}s @ (${xSeek},${yRuler})：` + JSON.stringify(await snap()));

await cdp.call(() => {
    const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
    fire('selectAll');
    fire('split');
});
await sleep(1400);
console.log('split 后：' + JSON.stringify((await snap()).clips, null, 1));
cdp.close();
