#!/usr/bin/env node
/**
 * E22-⑤「移动轨道动画（FLIP）」设备判据。
 *
 * 做法：**走真实手势**（长按轨道头 260ms 门槛 → 划动一格 → 抬手），
 * 并在抬手**之前**先在页面里装一个 rAF 采样器，记录每行的
 * `getComputedStyle(transform)` 与 `el.getAnimations().length`。
 * （不能等抬手后再读：动画只有 180ms，等 CDP 一个来回就结束了。）
 *
 * 判据：
 *   E22-F1 顺序真的变了（前后两次读到的行 id 序列不同）
 *   E22-F2 变更后有行处于**运行中的 WAAPI 动画**（anims > 0）且起始 transform ≠ none
 *   E22-F3 动画跑完后 transform 回到 `none`（不留常驻 transform ⇒ 不制造包含块）
 *   E22-F4 对照：置 `body[data-hs-no-anim]` 后同一动作 **没有任何动画**
 *
 * 用法：node scripts/_probe-e22-flip.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
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

/* 1. 轨道面板在场，且至少有 2 行（否则没得排序） */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    await new Promise((r) => setTimeout(r, 2600));
});
for (let i = 0; i < 4; i += 1) {
    const n = await cdp.call(() => document.querySelectorAll('[data-hs-track-row]').length);
    if (n >= 2) break;
    await cdp.call(() => {
        const add = [...document.querySelectorAll('div')].find(
            (d) => (d.textContent || '').trim() === '添加轨道',
        );
        add?.click();
    });
    await sleep(1200);
}
const geometry = () =>
    cdp.call(() => {
        const host = document.querySelector('[data-track-list-panel]');
        if (!host) return null;
        const rows = [...host.querySelectorAll('[data-hs-track-row]')];
        return {
            ids: rows.map((r) => r.getAttribute('data-hs-track-row')),
            rows: rows.map((r) => {
                const b = r.getBoundingClientRect();
                return {
                    /* ⚠️ 起手点**不能用 `left+40`**：那一带是轨道头上的 32×32 圆形按钮
                       （M/S/C 或名称），而 `onStart` 有"落在交互控件上不参与排序"的守卫
                       ⇒ 拖拽永不激活（实测 `elementFromPoint(40,·)` = `BUTTON`）。
                       `left+62` 是已验证的空档（`elementFromPoint` = 普通 DIV）。 */
                    cx: Math.round(b.left + 62),
                    cy: Math.round(b.top + b.height / 2),
                    h: Math.round(b.height),
                    t: Math.round(b.top),
                };
            }),
        };
    });
const g0 = await geometry();
console.log('▸ 初始行：' + JSON.stringify(g0?.ids));
if (!g0 || g0.rows.length < 2) {
    console.log('🔴 轨道不足 2 行 ⇒ 无法验排序动画');
    cdp.close();
    process.exit(1);
}

/* 2. 装 rAF 采样器（抬手前装好） */
const armSampler = () =>
    cdp.call(() => {
        const host = document.querySelector('[data-track-list-panel]');
        window.__flipLog = [];
        window.__flipStop = false;
        const t0 = performance.now();
        const tick = () => {
            if (window.__flipStop) return;
            const rows = [...host.querySelectorAll('[data-hs-track-row]')];
            window.__flipLog.push({
                dt: Math.round(performance.now() - t0),
                rows: rows.map((r) => ({
                    id: r.getAttribute('data-hs-track-row'),
                    tx: getComputedStyle(r).transform,
                    anims: r.getAnimations().length,
                })),
            });
            /* 采样窗口必须盖住**整个拖拽**：`dragRow` 里先是 950ms 的"短按选中"，
               再是 560ms 长按 + 4×70ms 划动 ≈ 1.8s。第一版只采 900ms ⇒ 抬手那一刻
               早就不采了，`firstAnimated` 恒 null，看起来像"没做动画"。 */
            if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    });

/** 长按轨道头 → 划动 dy → 抬手 */
const dragRow = async (rowIdx, dy) => {
    /* ⚠️ 先**短按选中**这一行再拖：行的 `onPointerDownCapture` 在"未选中"时会
       调 `onSelectTrack`（redux dispatch）⇒ 重渲染 ⇒ 原生 touch 那个 `useEffect`
       的依赖含 `onMoveTrack`，identity 一变就 `reset()` 掉刚武装的候选。
       选中后不再 dispatch，武装才能活到抬手。 */
    const g0 = await geometry();
    const r0 = g0.rows[rowIdx];
    await touch('touchStart', [{ x: r0.cx, y: r0.cy }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(950);

    const g = await geometry();
    const r = g.rows[rowIdx];
    await touch('touchStart', [{ x: r.cx, y: r.cy }]);
    /* ⚠️ 武装门槛是 `ARM_MS = 450`（`TrackList` 的原生 touch 实现），
       而**没武装就动**（`> CANCEL_PX = 12px`）会走"上下划平移视野"分支直接放弃候选。
       第一版探针只按 420ms ⇒ 永远排不动，误判成"动画没做"。留足余量按 560ms。 */
    await sleep(560);
    const steps = 4;
    for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', [{ x: r.cx, y: Math.round(r.cy + (dy * i) / steps) }]);
        await sleep(70);
    }
    await sleep(150);
    await touch('touchEnd', []);
};

/* 3. 正式一次：把第 2 行往上拖一格 */
await armSampler();
await dragRow(1, -g0.rows[1].h);
await sleep(1300);
const g1 = await geometry();
const orderChanged1 = JSON.stringify(g1.ids) !== JSON.stringify(g0.ids);
check(
    'E22-F1 拖动排序后行顺序**真的变了**',
    orderChanged1,
    `${JSON.stringify(g0.ids)} → ${JSON.stringify(g1.ids)}`,
);

const log1 = await cdp.call(() => {
    window.__flipStop = true;
    const l = window.__flipLog || [];
    let firstAnimated = null;
    let lastRow0 = null;
    for (const s of l) {
        if (!firstAnimated) {
            const hit = s.rows.find((r) => r.anims > 0);
            if (hit) firstAnimated = { dt: s.dt, ...hit };
        }
        lastRow0 = s;
    }
    const animatedIds = new Set();
    for (const s of l) for (const r of s.rows) if (r.anims > 0) animatedIds.add(r.id);
    return {
        samples: l.length,
        firstAnimated,
        animatedIds: [...animatedIds],
        lastTransforms: (lastRow0?.rows || []).map((r) => r.tx),
    };
});
console.log('▸ 采样：' + JSON.stringify(log1));
check(
    'E22-F2 变更后出现**运行中的 WAAPI 动画**且起始 transform ≠ none',
    Boolean(log1.firstAnimated && log1.firstAnimated.tx && log1.firstAnimated.tx !== 'none'),
    JSON.stringify(log1.firstAnimated),
);
check(
    'E22-F3 动画跑完后 transform 回到 `none`（不留常驻 transform）',
    log1.lastTransforms.length > 0 && log1.lastTransforms.every((t) => t === 'none'),
    JSON.stringify(log1.lastTransforms),
);

/* 4. 对照：关掉动效后再排一次（拖回去），应当**没有**任何动画 */
await cdp.call(() => {
    document.body.setAttribute('data-hs-no-anim', '');
    return true;
});
const g2 = await geometry();
await armSampler();
await dragRow(0, g2.rows[0].h);
await sleep(1300);
const log2 = await cdp.call(() => {
    window.__flipStop = true;
    const l = window.__flipLog || [];
    let any = 0;
    for (const s of l) for (const r of s.rows) if (r.anims > 0) any += 1;
    return { samples: l.length, anyAnimated: any };
});
const g3 = await geometry();
await cdp.call(() => {
    document.body.removeAttribute('data-hs-no-anim');
    return true;
});
console.log('▸ 对照：' + JSON.stringify(log2) + ` 顺序 ${JSON.stringify(g2.ids)} → ${JSON.stringify(g3.ids)}`);
check(
    'E22-F4 对照：`body[data-hs-no-anim]` 下同一动作**没有任何动画**',
    log2.anyAnimated === 0 && JSON.stringify(g2.ids) !== JSON.stringify(g3.ids),
    JSON.stringify(log2),
);

console.log(`\n── E22-⑤ FLIP 汇总：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
