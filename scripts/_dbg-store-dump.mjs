#!/usr/bin/env node
/**
 * 一次性取证：dump 页面状态 —— 块 / 选中 / **控制点渲染前提** / 视口真值。
 *
 * 【为什么需要】E5「音频块头尾的控制点」在设备上测到 `dotLeft=null dotRight=null`
 * （圆点一个都没渲染），但代码里渲染条件有好几层，必须一次把前提全打出来才能定位：
 *   `ClipControlPoints` 的守卫 —— `g !== null` → `isPhone` → `multiSelectedCount ≤ 1`
 *   → `horizontallyVisible` → `dotPressable(baseX)`（圆点中心要落在时间线容器内）。
 * 任何一个不成立都表现为"圆点不见了"，而外表完全一样。
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
    const rect = (el) => {
        const b = el.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    };
    const w = window;
    const s = w.__hsStore ?? w.__hfsStore;
    const out = {
        href: String(location.href),
        innerWidth: window.innerWidth,
        panes: [...document.querySelectorAll('[data-hs-pane]')].map((el) => el.getAttribute('data-hs-pane')),
        /* ── 控制点渲染证据 ── */
        cpRoot: Boolean(document.querySelector('[data-hs-clip-control-points]')),
        dots: [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => ({
            side: el.getAttribute('data-hs-clip-control-point'),
            mode: el.getAttribute('data-hs-control-mode'),
            dragging: el.getAttribute('data-hs-control-dragging'),
            rect: rect(el),
        })),
        quickActions: document.querySelectorAll('[data-hs-clip-actions]').length,
        /* ── 轨道行（控制点纵坐标的真值来源）── */
        trackRows: [...document.querySelectorAll('[data-hs-track-row]')].map((el) => ({
            id: el.getAttribute('data-hs-track-row'),
            rect: rect(el),
        })),
        /* ── 内核视口真值 ── */
        viewport: (() => {
            const v = w.__hsViewport ? w.__hsViewport() : null;
            if (!v) return null;
            return {
                scrollLeft: Math.round(v.scrollLeft),
                scrollTop: Math.round(v.scrollTop),
                pxPerSec: +(v.pxPerSec ?? 0).toFixed(3),
                rowHeight: v.rowHeight,
                containerRect: v.containerRect
                    ? [
                          Math.round(v.containerRect.left),
                          Math.round(v.containerRect.top),
                          Math.round(v.containerRect.width),
                          Math.round(v.containerRect.height),
                      ]
                    : null,
            };
        })(),
        hasStore: Boolean(s),
    };
    if (s) {
        const st = s.getState().session;
        out.clips = (st.clips || []).length;
        out.selectedClipId = st.selectedClipId ?? null;
        out.multiSelectedClipIds = (st.multiSelectedClipIds || []).length;
        out.clipBrief = (st.clips || []).slice(0, 4).map((c) => ({
            id: c.id,
            trackId: c.trackId,
            startSec: +(c.startSec ?? 0).toFixed(2),
            lengthSec: +(c.lengthSec ?? 0).toFixed(2),
            sourceStartSec: +(c.sourceStartSec ?? 0).toFixed(2),
        }));
    }
    return out;
});
console.log(JSON.stringify(r, null, 2));
cdp.close();
