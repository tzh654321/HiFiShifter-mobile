#!/usr/bin/env node
/**
 * 只读侦察：当前时间线里有哪些音频块（不写任何数据）。
 *
 * 用途：#6 真机复测前先看清"现场" —— 有没有块、多宽、在容器哪一段，
 * 免得 `--prep` 把用户工程里的素材清掉。
 *
 * 用法：node scripts/_dbg-clip-state.mjs --serial 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const argv = process.argv;
let serial = '221deeb';
for (let i = 2; i < argv.length; i++) if (argv[i] === '--serial') serial = argv[++i];

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
if (!pid) throw new Error('应用没在跑');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const out = await cdp.call(() =>
    window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
        const vp = window.__hsViewport();
        const c = vp.containerRect;
        const pane = document.querySelector('[data-hs-pane="timeline"]');
        const pr = pane ? pane.getBoundingClientRect() : null;
        return {
            clips: (s.clips || []).map((k) => {
                const left = c.left + k.start_sec * vp.pxPerSec - vp.scrollLeft;
                const width = Math.max(24, k.length_sec * vp.pxPerSec);
                return {
                    id: k.id,
                    name: k.name || k.file_name || null,
                    left: Math.round(left),
                    right: Math.round(left + width),
                    width: Math.round(width),
                    start: +Number(k.start_sec).toFixed(3),
                    len: +Number(k.length_sec).toFixed(3),
                    src: [+Number(k.source_start_sec).toFixed(3), +Number(k.source_end_sec).toFixed(3)],
                    track: k.track_id,
                };
            }),
            tracks: (s.tracks || []).map((t) => t.id),
            selected: typeof window.__hsDragDebug === 'function' ? window.__hsDragDebug().selectedClipId : null,
            viewport: {
                pxPerSec: +Number(vp.pxPerSec).toFixed(3),
                scrollLeft: Math.round(vp.scrollLeft),
                container: { left: Math.round(c.left), top: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) },
            },
            pane: pr ? { left: Math.round(pr.left), top: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
            rows: [...document.querySelectorAll('[data-hs-track-row]')].map((el) => {
                const r = el.getBoundingClientRect();
                return { id: el.getAttribute('data-hs-track-row'), top: Math.round(r.top), h: Math.round(r.height) };
            }),
        };
    }),
);

console.log(`块 ${out.clips.length} 个 · 轨道 ${out.tracks.length} 条 · 选中=${out.selected}`);
console.log(`视口 pxPerSec=${out.viewport.pxPerSec} scrollLeft=${out.viewport.scrollLeft} 容器=${JSON.stringify(out.viewport.container)}`);
console.log(`面板 pane=${JSON.stringify(out.pane)}`);
for (const r of out.rows) console.log(`  行 ${r.id} top=${r.top} h=${r.h}`);
for (const k of out.clips) {
    console.log(
        `  块 ${k.id} [${k.left},${k.right}] w=${k.width} start=${k.start} len=${k.len} src=${JSON.stringify(k.src)} row=${k.track}`,
    );
}
cdp.close();
process.exit(0);
