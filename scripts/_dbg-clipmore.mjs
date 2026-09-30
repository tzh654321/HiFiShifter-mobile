#!/usr/bin/env node
/**
 * 取证：音频块浮条上的「更多（…）」为什么打不开菜单。
 *
 * 用户原话（2026-09-30）：音频块临时菜单的「…」点击后**仍**打不开（长按也会产生那个菜单）。
 *
 * 链路：`ClipQuickActions` 的 `more` ⇒ `window.dispatchEvent('hs-open-clip-context-menu')`
 * ⇒ `TimelinePanel` 的监听 ⇒ `setContextMenu({x,y,clipId})` ⇒ portal 渲染 `ClipContextMenu`。
 * 本脚本逐段取证：① 事件有没有到监听（处理器里有 `[g1]` 日志）② 菜单 DOM（`[role=menu]`）有没有出现。
 *
 * 用法：node scripts/_dbg-clipmore.mjs emulator-5554
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内：算块的位置（用内核视口真值）。 */
function inPageClipGeom() {
    const vp = window.__hsViewport ? window.__hsViewport() : null;
    if (!vp) return { error: 'no-viewport' };
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((st) => {
        const clips = [...(st.clips || [])].sort((a, b) => a.start_sec - b.start_sec);
        const clip = clips[0];
        if (!clip) return { error: 'no-clip' };
        const tracks = st.tracks || [];
        const rowIndex = Math.max(0, tracks.findIndex((t) => t.id === clip.track_id));
        const c = vp.containerRect;
        const left = c.left + clip.start_sec * vp.pxPerSec - vp.scrollLeft;
        const width = Math.max(24, clip.length_sec * vp.pxPerSec);
        const top = c.top + rowIndex * vp.rowHeight - vp.scrollTop;
        const h = Math.max(12, vp.rowHeight - 2);
        return {
            clip: { id: clip.id, startSec: clip.start_sec, lengthSec: clip.length_sec, rowIndex },
            /** 落在块**中间偏左**（避开左右控制点浮层）。 */
            tap: { x: Math.round(left + Math.min(60, width / 2)), y: Math.round(top + h / 2) },
            geom: { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(h) },
            container: c,
        };
    });
}

/** 页面内：读浮条里的「更多」按钮位置 + 当前 DOM 摘要。 */
function inPageBarState() {
    const bar = document.querySelector('[data-hs-clip-actions]');
    const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.getAttribute('aria-label') || '') === '\u66f4\u591a',
    );
    let box = null;
    if (btn) {
        const r = btn.getBoundingClientRect();
        box = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
    }
    return {
        barPresent: !!bar,
        barButtons: bar
            ? [...bar.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || '').slice(0, 6))
            : [],
        more: box,
        menus: document.querySelectorAll('[role="menu"]').length,
        logs: (window.__hsLogs || []).slice(-8),
    };
}

/** 页面内：在「更多」按钮上装事件记录器 + 看该点被谁命中。 */
function inPageArmMore() {
    const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.getAttribute('aria-label') || '') === '\u66f4\u591a',
    );
    if (!btn) return { error: 'no-more-btn' };
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    window.__hsMoreEv = [];
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend']) {
        btn.addEventListener(
            type,
            (e) => {
                window.__hsMoreEv.push(
                    type + '(target=' + (e.target && e.target.tagName) + ',cur=' + (e.currentTarget === btn) + ')',
                );
            },
            true,
        );
    }
    /* 浮条被移除也要记一笔：那会让 click 永远拿不到 target */
    if (!window.__hsMoreObs) {
        window.__hsMoreObs = true;
        const obs = new MutationObserver((muts) => {
            for (const m of muts) {
                for (const n of m.removedNodes) {
                    if (n.nodeType === 1 && (n === btn || (n.contains && n.contains(btn)))) {
                        window.__hsMoreEv.push('BAR-REMOVED');
                    }
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
    return {
        box: { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) },
        stack: document
            .elementsFromPoint(cx, cy)
            .slice(0, 5)
            .map((e) => e.tagName + '.' + String(e.className || '').slice(0, 26) + (e === btn ? ' <=【更多】' : '')),
    };
}

function inPageReadMore() {
    return { ev: window.__hsMoreEv || [], menus: document.querySelectorAll('[role="menu"]').length, logs: (window.__hsLogs || []).slice(-6) };
}

function inPageResetLogs() {
    window.__hsLogs = [];
    return true;
}

async function main() {
    const serial = process.argv[2] || 'emulator-5554';
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const tap = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 8, radiusY: 8, force: 1 }],
        });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(700);
    };

    const g = await cdp.call(inPageClipGeom);
    console.log('▸ 块：' + JSON.stringify(g));
    if (g.error) throw new Error(JSON.stringify(g));

    console.log('--- ① 点块（应弹出浮条）---');
    await tap(g.tap.x, g.tap.y);
    let s = await cdp.call(inPageBarState);
    console.log('  浮条=' + s.barPresent + '  按钮=' + JSON.stringify(s.barButtons) + '  更多=' + JSON.stringify(s.more));

    console.log('--- ② 点「更多」---');
    await cdp.call(inPageResetLogs);
    if (!s.more) throw new Error('找不到「更多」按钮（浮条未出现？）');
    const armed = await cdp.call(inPageArmMore);
    console.log('  命中栈=' + JSON.stringify(armed.stack));
    await tap(s.more.x, s.more.y);
    await sleep(600);
    const mv = await cdp.call(inPageReadMore);
    console.log('  按钮上的事件=' + JSON.stringify(mv.ev));
    s = await cdp.call(inPageBarState);
    console.log('  [role=menu] 数量=' + s.menus + '  浮条仍在=' + s.barPresent);
    console.log('  [g1] 日志=' + JSON.stringify(mv.logs));

    console.log('--- ③ 对照：直接派发同一个事件 ---');
    await cdp.call(inPageResetLogs);
    await cdp.call(
        (d) =>
            window.dispatchEvent(
                new CustomEvent('hs-open-clip-context-menu', { detail: { x: d.x, y: d.y, clipId: d.clipId } }),
            ),
        { x: g.tap.x, y: g.tap.y, clipId: g.clip.id },
    );
    await sleep(800);
    s = await cdp.call(inPageBarState);
    console.log('  [role=menu] 数量=' + s.menus);
    console.log('  [g1] 日志=' + JSON.stringify(s.logs));

    cdp.close();
}

await main();
