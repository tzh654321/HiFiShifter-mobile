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
/* 让采样读数知道"哪一行是被拖的"（E33-8 只关心它）。 */
await cdp.call((id) => {
    window.__e33DragId = id;
    return true;
}, rDown.id);
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
/* 松手前后的逐帧读数：**单独起一个短采样器** —— 上面那个总采样器只跑 6s，
   而整条探针跑到这里早就超时了 ⇒ 第一版 E33-8 读到空数组（探针自己的 bug，不是产品的）。 */
await cdp.call(() => {
    const host = document.querySelector('[data-track-list-panel]');
    window.__e33rel = { log: [], stop: false };
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
    let n = 0;
    const tick = () => {
        if (window.__e33rel.stop || n > 30) return;
        n += 1;
        const r = host ? host.querySelector(`[data-hs-track-row="${window.__e33DragId}"]`) : null;
        window.__e33rel.log.push({ dt: Math.round(performance.now() - t0), ty: r ? ty(r) : null });
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
});
const tyBeforeRelease = duringDown.rows.find((r) => r.id === rDown.id)?.ty ?? NaN;
await touch('touchEnd', []);
await sleep(1400);
const gC = await geometry();
check(
    'E33-7 向下拖一格后**顺序真的翻转**（修前：跟手了但完全排不动）',
    JSON.stringify(gC.ids) !== JSON.stringify(gB.ids),
    `${JSON.stringify(gB.ids)} → ${JSON.stringify(gC.ids)}`,
);

/* ── E33-8（2026-10-03 用户口径）：「松手归位时**不是从手的位置**而是从原位置开始弹」──
   判据 = 松手后**第一帧**被拖行的 `translateY` 应该**接着松手前那个值**继续收，
   而不是当场变成 0（立刻吸附到目标槽 ⇒ 视觉上"啪"一下）或跳到别的量级。
   读数直接打出来，红了就知道是哪一类。 */
{
    const series = await cdp.call(() => (window.__e33rel ? window.__e33rel.log : []));
    const first = series.find((s) => s.ty !== null);
    const ok =
        first !== undefined &&
        Math.abs(first.ty - tyBeforeRelease) <= Math.max(10, Math.abs(tyBeforeRelease) * 0.25);
    check(
        'E33-8 松手后**第一帧接着手指的位置**继续（不是从原位置/0 开始）',
        ok,
        `松手前 ty=${tyBeforeRelease}；松手后前 10 帧 ty=${JSON.stringify(series.slice(0, 10).map((s) => s.ty))}`,
    );
}

/* ── E33-9（2026-10-03 用户口径）：「拖到**特殊位置**会出现下方轨道**来回弹**（看着像闪烁）」──
   "特殊位置" = anchor 滑过**不同层级**的行（子轨 / 别的父级）时，落点被判无效、让位被清空，
   手指稍退又恢复 ⇒ 让位表 **非空 → 空 → 非空** 反复 = 视觉闪烁；松手正落在"空"那一态
   就整行滑回原槽（用户说的"从原位置开始弹"）。
   判据 = **整张列表往下扫一遍**，逐步记录"非被拖行的那些行的让位向量"：
   出现「上一格非空、本格全空、下一格又非空」的塌陷 ⇒ 判红（修前正是这个形状）。 */
{
    const gD = await geometry();
    const head = gD.rows[0];
    await cdp.call((id) => {
        window.__e33DragId = id;
        return true;
    }, head.id);
    const orderBefore = gD.ids;
    await touch('touchStart', [{ x: head.cx, y: head.cy }]);
    await sleep(560);
    const seq = [];
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', [
            { x: head.cx, y: Math.round(head.cy + (head.h * 0.5 * i)) },
        ]);
        await sleep(90);
        const rs = (await geometry()).rows;
        seq.push(
            rs
                .filter((r) => r.id !== head.id)
                .map((r) => r.ty)
                .join(','),
        );
    }
    const nonEmpty = seq.map((s) => s !== '' && s !== '0' && !/^(0,)*0$/.test(s));
    let collapses = 0;
    for (let i = 1; i < nonEmpty.length - 1; i += 1) {
        if (!nonEmpty[i] && nonEmpty[i - 1] && nonEmpty[i + 1]) collapses += 1;
    }
    await touch('touchEnd', []);
    await sleep(1400);
    const orderAfter = (await geometry()).ids;
    const moved = JSON.stringify(orderBefore) !== JSON.stringify(orderAfter);
    check(
        'E33-9 扫过整张列表：让位表**不塌陷**（修前"非空→空→非空"= 来回弹）且松手真的重排',
        collapses === 0 && moved,
        `塌陷次数=${collapses}；让位序列=${JSON.stringify(seq)}\n     顺序 ${JSON.stringify(orderBefore)} → ${JSON.stringify(orderAfter)}`,
    );
}

console.log(`\n── E33 轨道拖动跟手：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
process.exit(fail === 0 ? 0 : 1);