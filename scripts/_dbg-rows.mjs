#!/usr/bin/env node
/**
 * 真机行几何真值：`[data-hs-track-row]` 的**可视顺序与矩形** vs `state.tracks` 的**扁平顺序**。
 * 用于判断「探针按扁平下标 × rowHeight 算出的块内坐标」为什么会落空。
 *
 * 用法：node scripts/_dbg-rows.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const out = await cdp.call(() => {
        const vp = window.__hsViewport();
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const flat = (s.tracks || []).map((t) => ({ id: t.id, parent: t.parent_id, depth: t.depth }));
            const domRows = [...document.querySelectorAll('[data-hs-track-row]')].map((el, i) => {
                const r = el.getBoundingClientRect();
                return {
                    i,
                    id: el.getAttribute('data-track-id') || el.getAttribute('data-hs-track-row'),
                    top: Math.round(r.top),
                    height: Math.round(r.height),
                };
            });
            const cursors = [...document.querySelectorAll('div')]
                .filter((e) => e.style && e.style.cursor && e.style.cursor !== '')
                .map((e) => {
                    const r = e.getBoundingClientRect();
                    return {
                        cls: String(e.className).slice(0, 46),
                        cursor: e.style.cursor,
                        rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
                    };
                });
            return {
                vp: { rowHeight: vp.rowHeight, scrollTop: vp.scrollTop, scrollLeft: vp.scrollLeft, container: vp.containerRect },
                flat,
                domRows,
                cursors,
            };
        });
    });
    console.log('▸ 视口：' + JSON.stringify(out.vp));
    console.log('▸ 扁平轨道顺序：' + JSON.stringify(out.flat));
    console.log('▸ 轨道头 DOM 行（可视顺序）：' + JSON.stringify(out.domRows, null, 1));
    console.log('▸ 带 inline cursor 的元素：' + JSON.stringify(out.cursors, null, 1));
    cdp.close();
};

await main();
