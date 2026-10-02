#!/usr/bin/env node
/**
 * E33 判据 —— 拖动轨道排序时「**松手前纵向上始终跟手**」（用户口径：
 * 「拖动轨道的动画需要松手前纵向上始终跟手，类似浏览器标签页拖动排序的效果」）。
 *
 * 修前行为：触摸拖动**只算一个 `targetIndex`**，屏幕上什么都不动
 * （连插入指示线都只在鼠标路径上画）⇒ 用户完全看不到"拖到哪了"。
 *
 * 修后行为（`TrackList` 的原生 touch 排序 + `dragUi.dragDy/shifts`）：
 *   · 被拖行**跟手**（`translateY(手指位移)`，无过渡）；
 *   · 它经过的那几行**让位**一个行高（带 180ms 过渡）；
 *   · 抬手时把"拖动中的视觉位置"喂给既有 FLIP 当起点，动画从手指处吸附到目标槽位。
 *
 * 判据：
 *   E33-1 拖动**进行中**（未抬手）被拖行已带 `translateY` ≈ 手指位移（跟手）
 *   E33-2 同一时刻，被越过的那一行让位了 ≈ +一个行高
 *   E33-3 未参与的行**全程不动**（transform 恒为 none）
 *   E33-4 跟手是**连续**的：采样到 ≥3 个不同的中间值（不是"一次跳到位"）
 *   E33-5 抬手后顺序真的变了，且**不留常驻 transform**（不制造包含块）
 *   E33-6 反方向（**向下**拖一格）同样让位 —— 浮点边界坑的回归护栏
 *   E33-7 向下拖一格后顺序真的翻转
 *
 * 用法：node scripts/_probe-e33-track-follow.mjs [serial]
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
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 6,
            radiusY: 6,
            force: 1,
        })),
    });

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* ── 0. 面板 + 至少 3 行（要有一行"没参与"才能验 E33-3） ──────────────── */

await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    document.body.removeAttribute('data-hs-header-collapsed');
    await new Promise((r) => setTimeout(r, 2600));
});
for (let i = 0; i < 6; i += 1) {
    const n = await cdp.call(() => document.querySelectorAll('[data-hs-track-row]').length);
    if (n >= 3) break;
    await cdp.call(() => {
        const add = [...document.querySelectorAll('div')].find(
            (d) => (d.textContent || '').trim() === '添加轨道',
        );
        add?.click();
    });
    await sleep(1400);
}

/** 行几何：id / 起手点 / 高 / 相对列表顶的 top / 当前 translateY。 */
const geometry = () =>
    cdp.call(() => {
        const host = document.querySelector('[data-track-list-panel]');
        if (!host) return null;
        const ty = (el) => {
            const t = getComputedStyle(el).transform;
            if (!t || t === 'none') return 0;
            try {
                return Math.round(new DOMMatrixReadOnly(t).m42);
            } catch {
                return NaN;
            }
        };
        const hostTop = host.getBoundingClientRect().top;
        const rows = [...host.querySelectorAll('[data-hs-track-row]')];
        return {
            ids: rows.map((r) => r.getAttribute('data-hs-track-row')),
            rows: rows.map((r) => {
                const b = r.getBoundingClientRect();
                return {
                    id: r.getAttribute('data-hs-track-row'),
                    /* ⚠️ 起手点取 `left+62`：`left+40` 那一带是轨道头上的 32×32 圆形
                       按钮（M/S/C 或名称），而 `onStart` 有"落在交互控件上不参与排序"
                       的守卫 ⇒ 拖拽永不激活。 */
                    cx: Math.round(b.left + 62),
                    /* ⚠️ 行的 rect 含我们写的 `translateY` ⇒ 还原到布局位置要用 ty。 */
                    cy: Math.round(b.top - ty(r) + b.height / 2),
                    h: Math.round(b.height),
                    top: Math.round(b.top - hostTop - ty(r)),
                    ty: ty(r),
                };
            }),
        };
    });

const g0 = await geometry();
console.log('▸ 初始行：' + JSON.stringify(g0?.ids));
if (!g0 || g0.rows.length < 3) {
    console.log(`🔴 轨道不足 3 行（现有 ${g0?.rows.length ?? 0}）⇒ 该态不可判`);
    cdp.close();
    process.exit(1);
}

/* ── 1. 采样器：整段拖动期间记录每行 transform 与动画状态 ────────────── */

await cdp.call(() => {
    const host = document.querySelector('[data-track-list-panel]');
    window.__e33 = { log: [], stop: false };
    const ty = (el) => {
        const t = getComputedStyle(el).transform;
        if (!t || t === 'none') return 0;
        try {
            return Math.round(new DOMMatrixReadOnly(t).m42);
        } catch {
            return NaN;
        }
    };
    const t0 = performance.now();
    const tick = () => {
        if (window.__e33.stop) return;
        const rows = [...host.querySelectorAll('[data-hs-track-row]')];
        window.__e33.log.push({
            dt: Math.round(performance.now() - t0),
            rows: rows.map((r) => ({ id: r.getAttribute('data-hs-track-row'), ty: ty(r) })),
        });
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
});

/* ── 2. 真实手势：短按选中 ⇒ 长按 560ms 武装 ⇒ 向上拖一格（不松手） ──── */

const rowIdx = 1; // 拖第 2 行往上，让第 1 行让位
const rowH = g0.rows[rowIdx].h;
const dy = -rowH;
const cx = g0.rows[rowIdx].cx;
const cy = g0.rows[rowIdx].cy;

// 先短按选中（否则 `onPointerDownCapture` 会 dispatch 选中 ⇒ 重渲染 ⇒ effect 依赖变 ⇒ reset 掉候选）
await touch('touchStart', [{ x: cx, y: cy }]);
await sleep(60);
await touch('touchEnd', []);
await sleep(950);

const gMid = await geometry();
const cx2 = gMid.rows.find((r) => r.id === g0.ids[rowIdx])?.cx ?? cx;
const cy2 = gMid.rows.find((r) => r.id === g0.ids[rowIdx])?.cy ?? cy;

await touch('touchStart', [{ x: cx2, y: cy2 }]);
await sleep(560); // > ARM_MS(450)
const steps = 6;
for (let i = 1; i <= steps; i += 1) {
    await touch('touchMove', [{ x: cx2, y: Math.round(cy2 + (dy * i) / steps) }]);
    await sleep(70);
}
await sleep(140);

/* ── 3. **抬手之前**读数（关键） ────────────────────────────────────── */

const during = await geometry();
console.log(
    '▸ 拖动中（未抬手）：' +
        JSON.stringify(during.rows.map((r) => ({ id: r.id, ty: r.ty }))),
);
const draggingId = g0.ids[rowIdx];
const passedId = g0.ids[rowIdx - 1];
const draggedTy = during.rows.find((r) => r.id === draggingId)?.ty ?? NaN;
const passedTy = during.rows.find((r) => r.id === passedId)?.ty ?? NaN;

check(
    'E33-1 拖动**进行中**被拖行已跟手（`translateY` ≈ 手指位移）',
    Math.abs(draggedTy - dy) <= Math.max(12, rowH * 0.2),
    `行 ${draggingId} 手指位移 ${dy}px，实测 translateY=${draggedTy}px（容差 ${Math.max(12, Math.round(rowH * 0.2))}）`,
);

check(
    'E33-2 同一时刻，被越过的那一行**让位**了一个行高',
    Math.abs(passedTy - rowH) <= Math.max(8, rowH * 0.15),
    `行 ${passedId} 期望 +${rowH}px，实测 ${passedTy}px`,
);

const otherIds = g0.ids.filter((_, i) => i !== rowIdx - 1 && i !== rowIdx);
const otherTys = otherIds.map((id) => ({
    id,
    ty: during.rows.find((r) => r.id === id)?.ty ?? NaN,
}));
check(
    'E33-3 📌 未参与的行全程**不动**（transform 恒 0）',
    otherTys.every((o) => o.ty === 0),
    JSON.stringify(otherTys),
);

/* ── 4. 抬手 ───────────────────────────────────────────────────────── */

await touch('touchEnd', []);
await sleep(1500);
const g1 = await geometry();
check(
    'E33-5 抬手后顺序真的变了，且**不留常驻 transform**',
    JSON.stringify(g1.ids) !== JSON.stringify(g0.ids) && g1.rows.every((r) => r.ty === 0),
    `${JSON.stringify(g0.ids)} → ${JSON.stringify(g1.ids)}；残留 ty=` +
        JSON.stringify(g1.rows.map((r) => r.ty)),
);

/* ── 5. 跟手连续性：被拖行在拖动期间出现过若干个**不同的中间值** ─────── */

const log = await cdp.call(() => {
    window.__e33.stop = true;
    return window.__e33.log || [];
});
const series = log
    .map((s) => s.rows.find((r) => r.id === draggingId)?.ty)
    .filter((v) => typeof v === 'number' && v !== 0 && !Number.isNaN(v));
const uniq = [...new Set(series)];
check(
    'E33-4 跟手是**连续**的（采样到 ≥3 个不同的中间位移，而不是一次跳到位）',
    uniq.length >= 3,
    `不同值 ${uniq.length} 个：${JSON.stringify(uniq.slice(0, 8))}${uniq.length > 8 ? ' …' : ''}` +
        `（采样帧 ${log.length}）`,
);

/* ── 6. 反方向对照：**向下**拖一格也必须让位 ─────────────────────────
   ⚠️ 这一条是**回归护栏**：第一版用"被拖行顶端 + 位移"判落点，向下拖满一整格时
   `anchorY` 正好压在下一行的 `top` 上，而 rect 带小数 ⇒ 浮点误差判成 false ⇒
   落回自己 ⇒ **向下拖一格完全排不动**（向上拖同样的距离却正常）。
   已改用"被拖行**中心**"判定（余量半行高）。 */

const gA = await geometry();
const downRow = gA.rows[0];
await touch('touchStart', [{ x: downRow.cx, y: downRow.cy }]);
await sleep(60);
await touch('touchEnd', []);
await sleep(950);

const gB = await geometry();
const rDown = gB.rows[0];
await touch('touchStart', [{ x: rDown.cx, y: rDown.cy }]);
await sleep(560);
for (let i = 1; i <= 6; i += 1) {
    await touch('touchMove', [{ x: rDown.cx, y: Math.round(rDown.cy + (rDown.h * i) / 6) }]);
    await sleep(70);
}
await sleep(140);
const duringDown = await geometry();
const downNextId = gB.ids[1];
const nextTy = duringDown.rows.find((r) => r.id === downNextId)?.ty ?? NaN;
check(
    'E33-6 反方向（**向下**拖一格）同样让位（浮点边界坑的回归护栏）',
    Math.abs(nextTy + rDown.h) <= Math.max(8, rDown.h * 0.15),
    `行 ${downNextId} 期望 −${rDown.h}px（上移让位），实测 ${nextTy}px`,
);
await touch('touchEnd', []);
await sleep(1400);
const gC = await geometry();
check(
    'E33-7 向下拖一格后**顺序真的翻转**（修前：跟手了但完全排不动）',
    JSON.stringify(gC.ids) !== JSON.stringify(gB.ids),
    `${JSON.stringify(gB.ids)} → ${JSON.stringify(gC.ids)}`,
);

console.log(`\n── E33 轨道拖动跟手：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
process.exit(fail === 0 ? 0 : 1);
