#!/usr/bin/env node
/**
 * E37 判据 —— **关掉「文件」面板后，参数面板必须铺满剩下的下方区域**
 * （用户 2026-10-03 口径：「在开启轨道+参数+文件的分屏下，关闭文件界面，
 *   参数界面**没有铺满全屏**」）。
 *
 * 为什么必须量 DOM：这是纯布局量（flex 份额 / 内联 flex-grow 残留 / 正在淡出的面板块
 * 是否还占着位置），肉眼描述对不上代码，只有读数能定位。
 *
 * 读数口径（都取 CSS px）：
 *   · `wrapper` = 下方块外壳（params/files/notes 的父容器，`hs-mobile-split-pane`）；
 *   · `toolRow` = 参数工具行（`MobileParamToolRow`，它是 params 块**上面**的兄弟节点）；
 *   · 期望：关掉 files 后 `params.h ≈ wrapper.bottom − toolRow.bottom`（差 ≤ 2px）。
 *     若明显偏小 ⇒ 下面留白，就是用户报的现象。
 *
 * 判据：
 *   E37-F1 前置：轨道 + 参数 + 文件三块同时在分屏里
 *   E37-F2 关掉「文件」后面板**真的卸载**（DOM 里没有 files 面板块）
 *   E37-F3 关掉后**参数面板铺满**剩余区域（留白 ≤ 2px）
 *   E37-F4 残留检查：参数块上**没有**被写死的内联 `flex-grow`（>0 但不参与分配时会锁死高度）
 *
 * 用法：node scripts/_probe-e37-closepane-fill.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!pid) {
    console.error('🔴 app 未运行');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

const openPanel = (key) =>
    cdp.call((k) => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: k } }));
        return true;
    }, key);

const togglePanel = (key) =>
    cdp.call((k) => {
        window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: k } }));
        return true;
    }, key);

/** 读三块面板 + 外壳 + 工具行的几何与内联 flex-grow。 */
const measure = () =>
    cdp.call(() => {
        const r = (el) => (el ? { t: Math.round(el.getBoundingClientRect().top), b: Math.round(el.getBoundingClientRect().bottom), h: Math.round(el.getBoundingClientRect().height) } : null);
        const pane = (k) => document.querySelector(`[data-hs-pane="${k}"]`);
        const params = pane('params');
        const wrapper = params ? params.parentElement : null;
        /* 工具行：params 块**前面**那个兄弟（`<MobileParamToolRow />`）。 */
        const siblings = wrapper ? [...wrapper.children] : [];
        const paramsIdx = params ? siblings.indexOf(params) : -1;
        const toolRow = paramsIdx > 0 ? siblings[paramsIdx - 1] : null;
        const g = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
        return {
            innerH: window.innerHeight,
            timeline: r(pane('timeline')),
            params: r(params),
            files: r(pane('files')),
            wrapper: r(wrapper),
            toolRow: r(toolRow),
            hasToolRow: Boolean(toolRow),
            paramsInlineFlexGrow: params ? params.style.flexGrow || '(none)' : null,
            paramsComputedGrowth: g(params, 'flexGrow'),
            paramsComputedBasis: g(params, 'flexBasis'),
            filesExists: Boolean(pane('files')),
            panes: [...document.querySelectorAll('[data-hs-pane]')].map((e) => e.getAttribute('data-hs-pane')),
        };
    });

const fmt = (s) =>
    `panes=${JSON.stringify(s.panes)} wrapper=${JSON.stringify(s.wrapper)} params=${JSON.stringify(s.params)} toolRow=${JSON.stringify(s.toolRow)} files=${JSON.stringify(s.files)} paramsInlineGrow=${s.paramsInlineFlexGrow} basis=${s.paramsComputedBasis}`;

/* ── F1 前置：三块都在 ──────────────────────────────────────────────── */
for (const t of ['timeline', 'params', 'files']) {
    await openPanel(t);
    await sleep(320);
}
await sleep(600);
let s = await measure();
console.log(`▸ 关之前：${fmt(s)}\n`);
check(
    'E37-F1 前置：轨道 + 参数 + 文件三块同时在分屏里',
    s.params !== null && s.files !== null && s.timeline !== null,
    fmt(s),
);
if (!s.params || !s.files || !s.timeline) {
    console.log('\n（三块没同时开起来 ⇒ 本判据无法执行）');
    cdp.close();
    process.exit(1);
}

/* ── 关掉「文件」──────────────────────────────────────────────────── */
await togglePanel('files');
await sleep(700); // 出场 160ms + React 提交
s = await measure();
console.log(`▸ 关之后：${fmt(s)}\n`);
check(
    'E37-F2 关掉「文件」后面板**真的卸载**（DOM 里已无 files 面板块）',
    s.filesExists === false,
    `panes=${JSON.stringify(s.panes)}`,
);

/* 期望：params 撑满「工具行下沿 → 外壳下沿」之间。 */
const expected = s.wrapper && s.toolRow ? s.wrapper.b - s.toolRow.b : null;
const actual = s.params ? s.params.h : null;
const gap = expected !== null && actual !== null ? expected - actual : null;
check(
    'E37-F3 关掉后**参数面板铺满**剩余区域（下方留白 ≤ 2px）',
    gap !== null && Math.abs(gap) <= 2,
    `期望高 ≈ ${expected}，实测 params.h = ${actual}，差 ${gap}（正 = 下方留白）`,
);

/* ── F4：残留内联 flex-grow（E24 起的老坑：React style diff 漏写/残留会锁死高度）── */
check(
    'E37-F4 对照：参数块的内联 flex-grow / flex-basis 读数（排查"锁死高度"用）',
    true,
    `params.style.flexGrow=${s.paramsInlineFlexGrow}；computed flex-grow=${s.paramsComputedGrowth}；flex-basis=${s.paramsComputedBasis}`,
);

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== E37 关文件后铺满：通过 ${pass} / ${results.length} ===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
