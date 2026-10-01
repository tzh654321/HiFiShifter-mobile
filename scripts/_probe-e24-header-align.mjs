#!/usr/bin/env node
/**
 * E24-② 「轨道头缩回后，轨道头与轨道**逐行**对齐」判据。
 *
 * 用户 2026-10-01 复报：「轨道头缩回时**轨道与轨道头没对齐高度**」。
 * 既有 `_probe-e3-collapse-align.mjs` 只量了「拍数栏底边 → 轨道列表首行顶边」这一个差值，
 * 过不了"逐行高度"这一关（它 4/4 而用户仍不认可）⇒ 本判据按**逐行**比：
 *
 *   · DOM 侧：`[data-hs-track-row]` 的 `top` / `height`（轨道头列）
 *   · 内核侧：`window.__hsViewport()` 给出的 `containerRect` + `rowHeight` + `scrollTop`
 *     （泳道是 canvas 画的、没有 DOM ⇒ 只能由这个钩子换算）
 *
 * 判据（4 条）：
 *   E24-H1 **常态**下逐行对齐（第 i 行头 vs 第 i 条泳道，顶边与高度都 ≤2px）
 *   E24-H2 **收起态**下同样逐行对齐（这是用户报的那条）
 *   E24-H3 收起前后**每行高度不变**（≤1px）
 *   E24-H4 收起前后**首行顶边不变**（≤2px）
 *
 * 用法：node scripts/_probe-e24-header-align.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/** 量：逐行（DOM 头 vs 内核泳道） */
const measure = () =>
    cdp.call(() => {
        const vp = window.__hsViewport?.();
        const rows = [...document.querySelectorAll('[data-track-list-panel] [data-hs-track-row]')];
        const heads = rows.map((el) => {
            const r = el.getBoundingClientRect();
            return { top: Math.round(r.top), h: Math.round(r.height) };
        });
        /* 内核泳道：第 i 条的 top = 容器顶 + i*rowHeight − scrollTop（与命令台同口径） */
        const lanes = [];
        if (vp && vp.containerRect) {
            for (let i = 0; i < heads.length; i += 1) {
                lanes.push({
                    top: Math.round(vp.containerRect.top + i * vp.rowHeight - (vp.scrollTop ?? 0)),
                    h: Math.round(vp.rowHeight),
                });
            }
        }
        return {
            collapsed: document.body.getAttribute('data-hs-header-collapsed') === '1',
            heads,
            lanes,
            rowHeight: vp ? Math.round(vp.rowHeight) : null,
            containerTop: vp && vp.containerRect ? Math.round(vp.containerRect.top) : null,
        };
    });

/** 逐行最大偏差 */
const worstDelta = (m) => {
    if (!m.lanes.length || !m.heads.length) return { top: null, h: null };
    let top = 0;
    let h = 0;
    for (let i = 0; i < Math.min(m.heads.length, m.lanes.length); i += 1) {
        top = Math.max(top, Math.abs(m.heads[i].top - m.lanes[i].top));
        h = Math.max(h, Math.abs(m.heads[i].h - m.lanes[i].h));
    }
    return { top, h };
};

/* 进入轨道界面 */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    return true;
});
await sleep(1800);

const before = await measure();
console.log(
    `▸ 常态：行数=${before.heads.length} 内核 rowHeight=${before.rowHeight} 容器顶=${before.containerTop}\n` +
        `   头=${JSON.stringify(before.heads.slice(0, 4))}\n   道=${JSON.stringify(before.lanes.slice(0, 4))}`,
);
const d1 = worstDelta(before);
check(
    'E24-H1 **常态**下逐行对齐（顶边与高度都 ≤2px）',
    d1.top !== null && d1.top <= 2 && d1.h <= 2,
    `最大偏差：顶边 ${d1.top}px / 高度 ${d1.h}px`,
);

/* 进收起态（**直接置位**：与 E3 同口径 —— 要验的是收起态的样式与钩子，不是左划手势） */
await cdp.call(() => {
    document.body.setAttribute('data-hs-header-collapsed', '1');
    return true;
});
await sleep(500);
const after = await measure();
console.log(
    `▸ 收起后：行数=${after.heads.length} 内核 rowHeight=${after.rowHeight} 容器顶=${after.containerTop}\n` +
        `   头=${JSON.stringify(after.heads.slice(0, 4))}\n   道=${JSON.stringify(after.lanes.slice(0, 4))}`,
);
const d2 = worstDelta(after);
check(
    'E24-H2 **收起态**下逐行对齐（用户复报的那条）',
    d2.top !== null && d2.top <= 2 && d2.h <= 2,
    `最大偏差：顶边 ${d2.top}px / 高度 ${d2.h}px`,
);

/* 收起前后：行高不变 / 首行顶边不变 */
const n = Math.min(before.heads.length, after.heads.length);
let maxH = 0;
let maxTop = 0;
for (let i = 0; i < n; i += 1) {
    maxH = Math.max(maxH, Math.abs(before.heads[i].h - after.heads[i].h));
    maxTop = Math.max(maxTop, Math.abs(before.heads[i].top - after.heads[i].top));
}
check('E24-H3 收起前后**每行高度不变**（≤1px）', n > 0 && maxH <= 1, `最大行高变化 ${maxH}px（比了 ${n} 行）`);
check('E24-H4 收起前后**首行顶边不变**（≤2px）', n > 0 && maxTop <= 2, `最大顶边位移 ${maxTop}px`);

await cdp.call(() => {
    document.body.removeAttribute('data-hs-header-collapsed');
    return true;
});

console.log(`\n── E24-② 轨道头逐行对齐：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
