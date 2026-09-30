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

/* 2. 逐个关掉除 params 以外的面板（点每个面板自己的 ✕），每关一个等一拍 */
for (const k of ['timeline', 'files', 'notes']) {
    const hit = await cdp.call((key) => {
        const btn = document.querySelector(`[data-hs-pane="${key}"] .hs-panel-close`);
        if (!btn) return false;
        btn.click();
        return true;
    }, k);
    if (hit) {
        console.log(`  ▸ 关掉 ${k}`);
        await sleep(1400);
    }
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
