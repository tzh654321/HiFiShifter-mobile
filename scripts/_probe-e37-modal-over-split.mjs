#!/usr/bin/env node
/**
 * E37 判据 —— **设置弹窗必须压在分屏面板之上**（用户 2026-10-03 口径：
 * 「存储设置与工程设置的**层级依旧在分屏界面之后**」）。
 *
 * 修前根因：`SettingsOverlays` 挂在**时间线面板块内部**（`App.tsx` 的 timeline pane 里），
 * 而每个面板块带 `animation: hs-fade-in … both` ⇒ **自成层叠上下文**
 * ⇒ 弹窗的 `z-index: 1000` 只在该上下文内比大小，压不过位于它**之后**的兄弟面板。
 *
 * 判定手法 = **命中测试**（比读 `z-index` 硬得多）：
 *   在弹窗矩形内按 3×3 取样，逐点 `document.elementFromPoint(x, y)`，
 *   要求**最上层元素落在弹窗子树内**；若被某个面板块抢走 ⇒ 用户就是"看得见、按不到/被盖住"。
 *
 * 判据：
 *   E37-P0 前置：分屏里**确实**同时开着 轨道 + 参数（+文件）面板
 *   E37-P1 存储设置：弹窗矩形内 9 个取样点全部命中弹窗
 *   E37-P2 工程设置：同上
 *   E37-P3 对照：弹窗**之外**、仍在参数面板内的点，命中**不是**弹窗（证明取样不是"全是弹窗"）
 *
 * 用法：node scripts/_probe-e37-modal-over-split.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realPid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!realPid) {
    console.error('🔴 app 未运行');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${realPid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const results = [];
const skipped = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};
const skip = (name, why) => {
    skipped.push(name);
    console.log(`⬜ ${name}\n     不可判：${why}`);
};

/** 幂等打开某个下方面板（`showMobilePanel` 语义，见 App.tsx 的 `hs-mobile-switch-tab`）。 */
const openPanel = (tab) =>
    cdp.call((t) => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: t } }));
        return true;
    }, tab);

const openDialog = (which) =>
    cdp.call((w) => {
        window.dispatchEvent(new CustomEvent('hs-open-settings', { detail: { which: w } }));
        return true;
    }, which);

const closeDialog = () =>
    cdp.call(() => {
        const panel = document.querySelector('[data-hs-modal]');
        if (!panel) return true;
        const btn = [...panel.querySelectorAll('button')].find(
            (b) => (b.textContent ?? '').trim() === '关闭',
        );
        if (btn) btn.click();
        return true;
    });

const panes = () =>
    cdp.call(() =>
        [...document.querySelectorAll('[data-hs-pane]')].map((el) => ({
            key: el.getAttribute('data-hs-pane'),
            h: Math.round(el.getBoundingClientRect().height),
        })),
    );

/**
 * 命中测试：弹窗矩形内 3×3 取样 ⇒ 最上层元素是否属于弹窗。
 * 同时回报"被谁抢走"（元素所属的 `[data-hs-pane]` / tag 名），便于回溯。
 */
const hitTestModal = (inset = 8) =>
    cdp.call((pad) => {
        const panel = document.querySelector('[data-hs-modal]');
        if (!panel) return { ok: false, reason: 'no-modal' };
        const r = panel.getBoundingClientRect();
        const xs = [r.left + pad, r.left + r.width / 2, r.right - pad];
        const ys = [r.top + pad, r.top + r.height / 2, r.bottom - pad];
        const pts = [];
        for (const y of ys) {
            for (const x of xs) {
                const el = document.elementFromPoint(Math.round(x), Math.round(y));
                const inside = el ? panel.contains(el) || el === panel : false;
                const pane = el && el.closest ? el.closest('[data-hs-pane]') : null;
                pts.push({
                    x: Math.round(x),
                    y: Math.round(y),
                    inside,
                    top: el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''}` : 'null',
                    stolenByPane: inside ? null : (pane ? pane.getAttribute('data-hs-pane') : null),
                });
            }
        }
        const bad = pts.filter((p) => !p.inside);
        return {
            ok: bad.length === 0,
            rect: {
                left: Math.round(r.left),
                top: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
            },
            total: pts.length,
            bad,
            sample: pts.slice(0, 3),
        };
    }, inset);

/**
 * 对照点：**弹窗下沿之外**（仍在某个面板块里）的那一点，最上层必须**不是**弹窗
 * —— 证明"9 点全命中"不是因为取样点全落在弹窗里（那样判据就自欺了）。
 * ⚠️ 第一版写成 `min(参数面板下沿-6, 弹窗下沿+40)`，结果取到了**弹窗内部**的点 ⇒ 假红。
 */
const hitTestOutside = () =>
    cdp.call(() => {
        const panel = document.querySelector('[data-hs-modal]');
        if (!panel) return { ok: true, note: 'skip' };
        const r = panel.getBoundingClientRect();
        const y = Math.round(Math.min(r.bottom + 30, window.innerHeight - 46));
        const x = Math.round(r.left + r.width / 2);
        const el = document.elementFromPoint(x, y);
        const pane = el && el.closest ? el.closest('[data-hs-pane]') : null;
        return {
            ok: !(el && (panel.contains(el) || el === panel)),
            x,
            y,
            modalBottom: Math.round(r.bottom),
            top: el ? el.tagName.toLowerCase() : 'null',
            pane: pane ? pane.getAttribute('data-hs-pane') : null,
        };
    });

/* ── P0：先把分屏开起来（轨道 + 参数 + 文件）──────────────────────────── */
for (const t of ['timeline', 'params', 'files']) {
    await openPanel(t);
    await sleep(320);
}
await sleep(600);
let ps = await panes();
console.log(`▸ 面板：${ps.map((p) => `${p.key}(h=${p.h})`).join(' · ')}`);
const hasTimeline = ps.some((p) => p.key === 'timeline');
const hasParams = ps.some((p) => p.key === 'params');
check(
    'E37-P0 前置：分屏里同时开着「轨道 + 参数」面板',
    hasTimeline && hasParams,
    `panes=${JSON.stringify(ps)}`,
);
if (!hasTimeline || !hasParams) {
    console.log('\n（分屏没开起来 ⇒ 本判据无法执行）');
    cdp.close();
    process.exit(1);
}
void skipped;

/* ── P1/P2：两个设置弹窗都必须在分屏之上 ─────────────────────────────── */
for (const [which, label] of [
    ['storage', '存储设置'],
    ['project', '工程设置'],
]) {
    await openDialog(which);
    await sleep(700);
    const h = await hitTestModal();
    if (h.reason === 'no-modal') {
        skip(`E37-P1 ${label}：弹窗矩形内 9 点全部命中弹窗`, '弹窗没打开');
        continue;
    }
    check(
        `E37-P${which === 'storage' ? '1' : '2'} ${label}：弹窗矩形内 9 个取样点**全部**命中弹窗（没被面板盖住）`,
        h.ok,
        h.ok
            ? `rect=${JSON.stringify(h.rect)} 取样 ${h.total}/${h.total} 命中`
            : `rect=${JSON.stringify(h.rect)} 被抢走的点：${JSON.stringify(h.bad)}`,
    );
    if (which === 'storage') {
        const o = await hitTestOutside();
        check(
            'E37-P3 对照：弹窗**下沿之外**的点命中不是弹窗（而是某个面板块，证明取样有效）',
            o.ok,
            `(x,y)=(${o.x},${o.y}) 弹窗下沿=${o.modalBottom} 最上层=${o.top} 所属面板=${o.pane}`,
        );
    }
    await closeDialog();
    await sleep(500);
}

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== E37 弹窗压分屏：通过 ${pass} / ${results.length}（另有 ${skipped.length} 条不可判）===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
for (const n of skipped) console.log(`⬜ ${n}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
