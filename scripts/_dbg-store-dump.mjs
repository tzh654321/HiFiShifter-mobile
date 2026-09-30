#!/usr/bin/env node
/**
 * 一次性取证：dump 前端 store 里与"块 / 选中"有关的状态 + **页面基本身份信息**。
 *
 * 【要回答的问题】
 *  1) F1/G-1（浮条「更多」⇒ 右键那套菜单）一直不出菜单 —— 是不是"前端 store 里没有块"？
 *     （探针用后端 `import_audio_item` 造块，而它**不更新前端 store**，可能是前提不满足。）
 *  2) 真机上调 `Runtime.evaluate` 读 `[data-hs-pane]` 返回空数组，但同一时刻**截屏里面板都在**
 *     —— 需要确认到底连到了哪个文档（href / readyState / 是否有 iframe / 元素总数）。
 *
 * 用法：node scripts/_dbg-store-dump.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const r = await cdp.call(() => {
    const s = window.__hsStore ?? window.__hfsStore;
    const out = {
        /* ── 页面身份（判断 evaluate 落在哪个文档）── */
        href: String(location.href),
        readyState: String(document.readyState),
        title: String(document.title),
        allEls: document.querySelectorAll('*').length,
        frames: window.frames.length,
        hasTauri: typeof window.__TAURI_INTERNALS__ !== 'undefined',
        bodyLen: (document.body?.innerText || '').length,
        bodyHead: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
        /* ── 面板 / DOM 证据 ── */
        panes: [...document.querySelectorAll('[data-hs-pane]')].map((el) => el.getAttribute('data-hs-pane')),
        splitEl: Boolean(document.querySelector('[data-hs-mobile-split]')),
        canvases: document.querySelectorAll('canvas').length,
        /* ── store ── */
        hasStore: Boolean(s),
        domQuickActions: document.querySelectorAll('[data-hs-clip-actions]').length,
    };
    if (s) {
        const st = s.getState().session;
        out.clips = (st.clips || []).length;
        out.tracks = (st.tracks || []).length;
        out.selectedClipId = st.selectedClipId ?? null;
        out.selectedTrackId = st.selectedTrackId ?? null;
        out.clipIds = (st.clips || []).slice(0, 5).map((c) => c.id);
        out.mobilePanels = st.mobilePanels ?? null;
    }
    return out;
});
console.log(JSON.stringify(r, null, 2));
cdp.close();
