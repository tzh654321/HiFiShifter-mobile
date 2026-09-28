#!/usr/bin/env node
/** 临时：A3 探针的**点位诊断** —— 打印容器/行/块的真实矩形与落点命中，别猜。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] || '221deeb';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const out = await cdp.call(async () => {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    const v = window.__hsViewport ? window.__hsViewport() : null;
    if (!v) return { error: 'no-viewport' };
    const st = await invoke('get_timeline_state');
    const c = v.containerRect;
    const at = (x, y) => {
        const e = document.elementFromPoint(x, y);
        return e ? `${e.tagName}.${String(e.className).slice(0, 48)}` : null;
    };
    const R = (e) => {
        const r = e.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const rows = [...document.querySelectorAll('[data-hs-track-row]')].map((e) => ({
        id: e.getAttribute('data-hs-track-row').slice(0, 8),
        ...R(e),
    }));
    const clips = (st.clips || []).map((x) => ({
        id: x.id.slice(0, 10),
        tr: x.track_id.slice(0, 8),
        start: +x.start_sec.toFixed(3),
        len: +x.length_sec.toFixed(3),
        ss: +(x.source_start_sec ?? 0).toFixed(3),
        se: +(x.source_end_sec ?? 0).toFixed(3),
        rate: x.clip_playback_rate ?? x.playback_rate,
    }));
    const raw = (st.clips || [])[0];
    let point = null;
    if (raw) {
        const leftPx = c.left + raw.start_sec * v.pxPerSec - v.scrollLeft;
        const w = raw.length_sec * v.pxPerSec;
        const rowEl = document.querySelector(`[data-hs-track-row="${raw.track_id}"]`);
        const rr = rowEl ? rowEl.getBoundingClientRect() : null;
        const cx = Math.round(leftPx + w / 2);
        const cy = rr ? Math.round(rr.top + 18 + (rr.height - 2 - 18) / 2) : null;
        point = {
            x: cx,
            y: cy,
            rowRect: rr ? R(rowEl) : null,
            atPoint: cy === null ? null : at(cx, cy),
            stackAtPoint: cy === null ? null : document.elementsFromPoint(cx, cy).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 34)}`),
        };
    }
    const ruler = document.querySelector('[data-hs-time-ruler="timeline"]');
    return {
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        pxPerSec: Math.round(v.pxPerSec),
        scrollLeft: Math.round(v.scrollLeft),
        rowHeight: Math.round(v.rowHeight),
        container: R(document.querySelector('[data-hs-viewport-probe]') || { getBoundingClientRect: () => c }),
        containerRaw: { left: Math.round(c.left), top: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) },
        ruler: ruler ? R(ruler) : null,
        rulerFallbackY: Math.round(c.top - 24),
        rows,
        clipCount: (st.clips || []).length,
        clips: clips.slice(0, 4),
        point,
        surfaces: [...document.querySelectorAll('[data-hs-surface]')].map((e) => e.getAttribute('data-hs-surface')),
        canvases: [...document.querySelectorAll('canvas')].map((e) => ({ cls: String(e.className).slice(0, 30), ...R(e) })),
    };
});
console.log(JSON.stringify(out, null, 2));
cdp.close();
