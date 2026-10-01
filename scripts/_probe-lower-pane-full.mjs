#!/usr/bin/env node
/**
 * 验「只剩非轨道块（参数 / 文件）时应**独占**高度」—— E27。
 *
 * 【背景 · 2026-10-01 实测发现】分屏比例 `mobileSplitRatio` 只描述"轨道块 vs 下方块"。
 * `App.tsx` 里**上方块**早就有"只有一块时 `flexGrow: 1`"的保护，**下方块却漏了这半边**
 * —— 一直无条件写 `1 - mobileSplitRatio`。于是关掉轨道面板、只剩参数/文件块时，
 * 那块仍按比例分高：`ratio=0.5` 只占半屏；`ratio=0.94`（拖过分屏边界留下的极端值）
 * **只剩 26px**，整块几乎看不见。
 *
 * 【判据】只留参数块 ⇒ 它的高度应 ≥ 分屏容器高度的 **80%**（修前 = `1-ratio`，必挂）。
 *
 * ⚠️ 刻意**不**做 `Page.reload`：reload 会让 CDP 的 execution context 失效，
 * 之后的 `Runtime.evaluate` 落在旧上下文里、读什么都返回空（实测 `panes: []`，
 * 而同一时刻截屏里三个面板都在）。
 *
 * 用法：node scripts/_probe-lower-pane-full.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

/* 1. 确保参数面板在场（`showMobilePanel` 是**累加**语义） */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    return true;
});
await sleep(2500);

const before = await cdp.call(() => ({
    panes: [...document.querySelectorAll('[data-hs-pane]')].map((x) => x.getAttribute('data-hs-pane')),
    ratio: (() => {
        try {
            return localStorage.getItem('hifishifter.mobileSplitRatio');
        } catch {
            return null;
        }
    })(),
}));
console.log('▸ 起始面板：' + JSON.stringify(before));

/* 2. 逐个关掉除 params 以外的面板，每关一个等一拍。
 * ⚠️ 用 `hs-mobile-close-panel`（App 的官方路径）而不是点 ✕：只有 timeline / params 两块
 * 的 ✕ 带 `.hs-panel-close`（App 自己渲染的），files / notes 的 ✕ 在各自组件里
 * （Radix `IconButton`）⇒ 点按钮那条路**关不掉它们**，会让探针停在"params+files 平分
 * 下半块"的状态上，把 46.7% 误报成"被压扁"（2026-10-01 实测踩到）。
 * 🕳️ 那条事件进的是 `toggleMobilePanel` —— 是**翻转**不是关闭！对**已关闭**的面板派发
 * 反而会把它打开（实测：连派三次之后剩 pane = timeline+params+files）。所以先判在场再派发，
 * 且要排除"正在出场"的那块（闸门会把它多留 160ms）。 */
for (const k of ['timeline', 'files', 'notes']) {
    const onScreen = await cdp.call((key) => {
        const el = document.querySelector(`[data-hs-pane="${key}"]`);
        return !!el && !el.hasAttribute('data-hs-leaving');
    }, k);
    if (!onScreen) continue;
    await cdp.call(
        (key) => {
            window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key } }));
            return true;
        },
        k,
    );
    console.log(`  ▸ 关掉 ${k}`);
    await sleep(900);
}
await sleep(1000);

/* 3. 量高度 */
const m = await cdp.call(() => {
    const r = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    const panes = [...document.querySelectorAll('[data-hs-pane]')];
    return {
        containerH: r(document.querySelector('[data-hs-mobile-split]')),
        paramsH: r(document.querySelector('[data-hs-pane="params"]')),
        panes: panes.map((x) => x.getAttribute('data-hs-pane')),
    };
});
const ratio = m.containerH && m.paramsH !== null ? m.paramsH / m.containerH : 0;
const ok = m.panes.length === 1 && m.panes[0] === 'params' && ratio >= 0.8;
console.log(`▸ 剩余面板 = ${JSON.stringify(m.panes)}`);
console.log(`▸ 分屏容器高 ${m.containerH}px / params 高 ${m.paramsH}px ⇒ 占比 ${(ratio * 100).toFixed(1)}%`);
console.log(ok ? '✅ 只剩非轨道块时**独占**高度' : '🔴 只剩非轨道块仍被按比例压扁');
cdp.close();
process.exit(ok ? 0 : 1);
