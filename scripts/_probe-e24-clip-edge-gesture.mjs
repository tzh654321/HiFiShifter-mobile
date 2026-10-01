#!/usr/bin/env node
/**
 * E24-② 「控制点两段式手势」判据（规格 `docs/15` E 列 / 用户 2026-10-01 复报）。
 *
 * 规格原文：
 *   · 长按控制点 ⇒ **其上方出现淡入/淡出图标、下方出现变速缩放图标**；
 *   · **长按并划动**是**两段式**：**先上划（或下划）定型，再横滑调节** ——
 *     上划 ⇒ 调淡入淡出时长；下划 ⇒ 调变速缩放。
 *   · （本轮新增待确认）**限制控制点可拖动的范围**。
 *
 * 读数：`window.__hsClipProbe()`（本轮新增的**只读**验收钩子：选中块的
 * `fadeInSec/fadeOutSec/lengthSec/playbackRate` + 长按提示图标的在场与锚点）。
 * 块的淡变/速率是 **canvas 画的**、DOM 里没有痕迹，不读数值就只能靠肉眼。
 *
 * 判据（5 条）：
 *   E24-G1 长按 700ms ⇒ 提示出现，且 **fade 图标在上、stretch 图标在下**（规格的上/下）
 *   E24-G2 上划 24px（定型）后**横滑 +60px** ⇒ 该侧淡变时长**变大**，且定型后提示收起
 *   E24-G3 下划 24px（定型）后**横滑** ⇒ 长度 / 速率**发生变化**（拉伸档）
 *   E24-G4 长按后**不纵向定型**、直接横滑 40px ⇒ 淡变与长度**都不变**（两段式的第一段必须无副作用）
 *   E24-G5 观测：把淡变拖到极端，报告它被钳在什么值（**范围限制**的口径待与用户对齐）
 *
 * 用法：node scripts/_probe-e24-clip-edge-gesture.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

const touch = (type, pts, id = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p) => ({
            id: p.id ?? id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });

const probe = () => cdp.call(() => window.__hsClipProbe?.() ?? null);
const hintRect = () =>
    cdp.call(() => {
        const h = document.querySelector('[data-hs-edge-longpress-hint]');
        const f = document.querySelector('[data-hs-edge-hint="fade"]');
        const s = document.querySelector('[data-hs-edge-hint="stretch"]');
        return {
            hint: h ? h.getBoundingClientRect().top : null,
            fade: f ? f.getBoundingClientRect().top : null,
            stretch: s ? s.getBoundingClientRect().top : null,
            /* 🔴 自适应取控制点：块的**右边缘跑到屏外**时，按"按不到就不画"的规则右侧圆点
               根本不渲染（实测：容器 132..360，块 0.32s 起、2s × 150px/s ⇒ 右边缘在 x=480）。
               所以左右都试，取存在的那个，并把 side 带出来（决定读 fadeIn 还是 fadeOut）。 */
            cp: (() => {
                for (const side of ['right', 'left']) {
                    const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width <= 0) continue;
                    return {
                        side,
                        x: Math.round(r.left + r.width / 2),
                        y: Math.round(r.top + r.height / 2),
                    };
                }
                return null;
            })(),
        };
    });

/* ── 准备：确保有"选中的块" ─────────────────────────────────────────────── */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    return true;
});
await sleep(1600);

/* 🔴 前置：必须**单选中**。`multi.length > 1` 时 `ClipControlPoints` 按设计直接不渲染
   （实测踩到：自动备份恢复了旧工程 ⇒ 选中列表里有两个块 ⇒ 圆点一个都没有，
   会被误读成"控制点没画"）。下面按选中块的几何算一个块内点，逐行试单击，直到单选中。 */
const singleSelect = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const n = await cdp.call(() => window.__hsSelection?.()?.multi?.length ?? 0);
        if (n <= 1) return true;
        const g = await cdp.call(() => {
            const vp = window.__hsViewport?.();
            const c = window.__hsClipProbe?.()?.clip;
            if (!vp?.containerRect || !c) return null;
            const left =
                vp.containerRect.left + (c.startSec ?? 0) * vp.pxPerSec - (vp.scrollLeft ?? 0);
            return {
                x: Math.round(Math.min(left + 24, vp.containerRect.left + vp.containerRect.width - 24)),
                rowTop: vp.containerRect.top,
                rowH: vp.rowHeight,
            };
        });
        if (!g) return false;
        const y = Math.round(g.rowTop + g.rowH * (0.5 + attempt));
        await touch('touchStart', [{ x: g.x, y }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(500);
    }
    return (await cdp.call(() => window.__hsSelection?.()?.multi?.length ?? 0)) <= 1;
};
const single = await singleSelect();
console.log(`▸ 单选中：${single}`);

let st = await probe();
if (!st?.clip) {
    /* 没选中就点一下时间线中段（导入时块就落在这附近）把块选中 */
    await touch('touchStart', [{ x: 180, y: 231 }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(700);
    st = await probe();
}
if (!st?.clip) {
    console.log('🔴 前置不满足：没有可测的音频块（先跑 `_dbg-import-drag.mjs` 造一个）');
    cdp.close();
    process.exit(1);
}
console.log(`▸ 块：${JSON.stringify(st.clip)}`);
let cp = (await hintRect()).cp;
if (!cp) {
    const n = await cdp.call(() => window.__hsSelection?.()?.multi?.length ?? 0);
    console.log(
        `🔴 前置不满足：左右控制点都没渲染。选中数=${n}（>1 时不画控制点）；` +
            '也可能块的左右边缘都在屏外 ⇒ 先缩小 pxPerSec',
    );
    cdp.close();
    process.exit(1);
}

const base = { ...st.clip };
/** 控制点在左 ⇒ 调"淡入"；在右 ⇒ 调"淡出"（与内核 `edge.side === "left" ? "in" : "out"` 同口径）。 */
const fadeKey = cp.side === 'left' ? 'fadeInSec' : 'fadeOutSec';
const fadeOf = (c) => (c ? c[fadeKey] : null);
console.log(`▸ 控制点：${JSON.stringify(cp)}（淡变字段 = ${fadeKey}）`);

/* ── G1：长按 ⇒ 提示出现，且 fade 在上、stretch 在下 ───────────────────── */
await touch('touchStart', [{ x: cp.x, y: cp.y }]);
await sleep(700); // 长按门槛 500ms，留足
const h1 = await hintRect();
const p1 = await probe();
check(
    'E24-G1 长按 700ms ⇒ 提示出现，且 fade 图标在**上**、stretch 图标在**下**',
    !!p1?.hint && p1.hint.side === cp.side && p1.hint.fade && p1.hint.stretch &&
        h1.fade !== null && h1.stretch !== null && h1.fade < h1.stretch,
    `hint=${JSON.stringify(p1?.hint)}；fadeTop=${h1.fade} stretchTop=${h1.stretch}（应 fade<stretch）`,
);

/* ── G2：上划定型 ⇒ 横滑 ⇒ 淡出时长变大 ───────────────────────────────── */
for (let i = 1; i <= 3; i += 1) {
    await touch('touchMove', [{ x: cp.x, y: cp.y - i * 8 }]);
    await sleep(40);
}
await sleep(120);
const afterLock = await probe();
for (let i = 1; i <= 6; i += 1) {
    await touch('touchMove', [{ x: cp.x + i * 10, y: cp.y - 24 }]);
    await sleep(40);
}
const p2 = await probe();
await touch('touchEnd', []);
await sleep(600);
const p2b = await probe();
check(
    'E24-G2 **上划定型**后横滑 +60px ⇒ 淡出时长变大；定型时提示收起',
    (fadeOf(p2?.clip) ?? 0) > fadeOf(base) && afterLock?.hint === null,
    `${fadeKey} ${fadeOf(base)} → ${fadeOf(p2?.clip)}（提交后 ${fadeOf(p2b?.clip)}）；定型后 hint=${JSON.stringify(afterLock?.hint)}`,
);

/* ── G3：下划定型 ⇒ 横滑 ⇒ 长度/速率变化（拉伸档） ─────────────────────── */
const before3 = (await probe())?.clip ?? base;
cp = (await hintRect()).cp ?? cp;
await touch('touchStart', [{ x: cp.x, y: cp.y }]);
await sleep(700);
for (let i = 1; i <= 3; i += 1) {
    await touch('touchMove', [{ x: cp.x, y: cp.y + i * 8 }]);
    await sleep(40);
}
await sleep(120);
for (let i = 1; i <= 6; i += 1) {
    await touch('touchMove', [{ x: cp.x + i * 10, y: cp.y + 24 }]);
    await sleep(40);
}
const p3 = await probe();
await touch('touchEnd', []);
await sleep(600);
check(
    'E24-G3 **下划定型**后横滑 ⇒ 长度或速率发生变化（拉伸档）',
    !!p3?.clip &&
        (Math.abs(p3.clip.lengthSec - before3.lengthSec) > 0.001 ||
            Math.abs(p3.clip.playbackRate - before3.playbackRate) > 0.0001),
    `len ${before3.lengthSec} → ${p3?.clip?.lengthSec}；rate ${before3.playbackRate} → ${p3?.clip?.playbackRate}`,
);

/* ── G4：长按后**不纵向定型**直接横滑 ⇒ 不应有任何变化 ─────────────────── */
const before4 = (await probe())?.clip ?? base;
cp = (await hintRect()).cp ?? cp;
await touch('touchStart', [{ x: cp.x, y: cp.y }]);
await sleep(700);
for (let i = 1; i <= 4; i += 1) {
    await touch('touchMove', [{ x: cp.x + i * 10, y: cp.y }]);
    await sleep(40);
}
const p4 = await probe();
await touch('touchEnd', []);
await sleep(600);
check(
    'E24-G4 长按后**未纵向定型**直接横滑 ⇒ 淡变与长度都不变（两段式的第一段无副作用）',
    !!p4?.clip &&
        Math.abs(fadeOf(p4.clip) - fadeOf(before4)) < 0.001 &&
        Math.abs(p4.clip.lengthSec - before4.lengthSec) < 0.001,
    `${fadeKey} ${fadeOf(before4)} → ${fadeOf(p4?.clip)}；len ${before4.lengthSec} → ${p4?.clip?.lengthSec}`,
);

/* ── G5：观测 —— 淡变拖到极端时被钳在哪（范围限制的口径待对齐） ───────── */
const before5 = (await probe())?.clip ?? base;
cp = (await hintRect()).cp ?? cp;
await touch('touchStart', [{ x: cp.x, y: cp.y }]);
await sleep(700);
for (let i = 1; i <= 3; i += 1) {
    await touch('touchMove', [{ x: cp.x, y: cp.y - i * 8 }]);
    await sleep(40);
}
for (let i = 1; i <= 24; i += 1) {
    await touch('touchMove', [{ x: cp.x + i * 20, y: cp.y - 24 }]);
    await sleep(25);
}
const p5 = await probe();
await touch('touchEnd', []);
await sleep(500);
console.log(
    `▸ G5 观测（**不是判据**）：把控制点淡变一路拖到底 ⇒ ${fadeKey}=${fadeOf(p5?.clip)}` +
        `（起始 ${fadeOf(before5)}，块长 ${p5?.clip?.lengthSec}，源长 ${p5?.clip?.durationSec}）`,
);

/* ── G6：圆点"跟手、但显示不许跑离块附近"（E24-④，用户口径：限制圆点的显示） ── */
cp = (await hintRect()).cp ?? cp;
const dot0 = (await hintRect()).dot;
await touch('touchStart', [{ x: cp.x, y: cp.y }]);
await sleep(700);
/* 手指**大幅移开**（右下各 260/200px）：圆点必须被钳在"块附近" */
await touch('touchMove', [{ x: cp.x + 260, y: cp.y + 200 }]);
await sleep(150);
const dotFar = (await hintRect()).dot;
await touch('touchEnd', []);
await sleep(400);
/* 余量 = DOT_FOLLOW_MARGIN_PX(44) + DOT_R(7) + 2px 容差 */
const LIMIT = 53;
const dx = dot0 && dotFar ? Math.abs(dotFar.cx - dot0.cx) : null;
const dy = dot0 && dotFar ? Math.abs(dotFar.cy - dot0.cy) : null;
check(
    'E24-G6 手指大幅移开时，圆点仍被钳在**块附近**（偏移 ≤ 44+7px）',
    dx !== null && dy !== null && dx <= LIMIT && dy <= LIMIT,
    `圆点 ${JSON.stringify(dot0)} → ${JSON.stringify(dotFar)}（手指移了 +260/+200）⇒ Δ=${dx},${dy}（上限 ${LIMIT}）`,
);

console.log(`\n── E24-② 控制点两段式手势：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
