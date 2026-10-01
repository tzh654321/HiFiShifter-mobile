#!/usr/bin/env node
/**
 * E22 第二刀「出场动画」设备判据 —— 面板收起 / 菜单关闭**先淡出再卸载**。
 *
 * 被测机制：`hooks/useExitPresence.tsx`（挂载闸门）+ `index.css` 的
 * `hs-menu-out` / `hs-fade-out` 两条出场关键帧。闸门要点：
 *   · 关闭时渲染的是**关门前的子树快照**（否则菜单会当场跳位）；
 *   · 节点上打 `data-hs-leaving`，外层再套常驻的 `[data-hs-leaving-root]`（`display: contents`）
 *     —— 子节点是**组件**时属性到不了 DOM，靠这层后代选择器兜住；
 *   · portal 的包装层放进 portal **内部**（时间线右键菜单走这条）。
 *
 * 判据（6 条）：
 *   E22-X1 面板关闭后**仍在 DOM**、且根节点带 `data-hs-leaving`
 *   E22-X2 在场期间跑的是 `hs-fade-out`，且确实是渐变（中间不透明度帧 或 动画进度帧）
 *   E22-X3 离开期间 `pointer-events: none`（关掉的 UI 不许被点到）
 *   E22-X4 离开期间**高度没当场塌**（布局等它淡完再收 = 不出"两块挤一下"的闪动）
 *   E22-X5 出场时长走完后节点真的从 DOM 消失（不是只加了个动画）
 *   E22-X6 对照：`body[data-hs-no-anim]` 下关闭**立即**消失（无 leaving、无动画）—— 与改造前一致
 *   E22-X7 菜单（顶栏）同理：关闭后仍在 DOM 且带 leaving，跑 `hs-menu-out`，随后消失
 *
 * 用法：node scripts/_probe-e22-exit.mjs [serial]
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

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* ── 采样器：每帧记录"目标节点还在不在 / 带不带 leaving / 跑什么动画 / 不透明度 / 高度" ── */
const armSampler = (sel, windowMs) =>
    cdp.call(
        (selector, ms) => {
            window.__exLog = [];
            const t0 = performance.now();
            const tick = () => {
                const el = document.querySelector(selector);
                const anims = el ? el.getAnimations() : [];
                window.__exLog.push({
                    dt: Math.round(performance.now() - t0),
                    present: !!el,
                    leaving: el ? el.hasAttribute('data-hs-leaving') : null,
                    anims: anims.map((a) => a.animationName || '(js)'),
                    /* ⚠️ `progress` 是**动画自己**的时间进度：主线程被面板重排堵住时 rAF 会掉帧，
                       `opacity` 可能整段采不到中间值（实测踩过：中间帧读数 0 而逐帧取证里
                       0.48/0.31/0.19… 明明都在）。所以"有没有渐变"要以 progress 为准。 */
                    prog: anims.length
                        ? anims.map((a) => {
                              try {
                                  return a.effect?.getComputedTiming?.().progress ?? null;
                              } catch {
                                  return null;
                              }
                          })
                        : [],
                    opacity: el ? Number(getComputedStyle(el).opacity) : null,
                    h: el ? Math.round(el.getBoundingClientRect().height) : null,
                    pe: el ? getComputedStyle(el).pointerEvents : null,
                });
                if (performance.now() - t0 < ms) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            return true;
        },
        sel,
        windowMs,
    );

const readSampler = () =>
    cdp.call(() => {
        const l = window.__exLog || [];
        const leavingFrames = l.filter((s) => s.leaving);
        const anims = new Set();
        for (const s of l) for (const a of s.anims) anims.add(a);
        const midProgress = leavingFrames.filter((s) =>
            (s.prog || []).some((p) => p !== null && p > 0.05 && p < 0.95),
        ).length;
        return {
            samples: l.length,
            tail: l.slice(-3),
            leavingFrames: leavingFrames.length,
            firstLeaving: leavingFrames[0] ?? null,
            lastLeaving: leavingFrames[leavingFrames.length - 1] ?? null,
            anims: [...anims],
            /* 渐变证据两条任取其一：采样到的中间不透明度，或动画自身的中间进度 */
            midOpacity: leavingFrames.filter(
                (s) => s.opacity !== null && s.opacity > 0.0005 && s.opacity < 0.9995,
            ).length,
            midProgress,
        };
    });

/* ── 场景准备：参数面板打开（保证"至少保留一个"的守卫不挡关闭），轨道面板也打开 ── */
const switchTab = async (tab) => {
    await cdp.call(
        (t) => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: t } }));
            return true;
        },
        tab,
    );
    await sleep(1200);
};
const closePanel = async (key) => {
    await cdp.call(
        (k) => {
            window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: k } }));
            return true;
        },
        key,
    );
};

await switchTab('params');
await switchTab('timeline');
const bothOpen = await cdp.call(() => ({
    timeline: !!document.querySelector('[data-hs-pane="timeline"]'),
    params: !!document.querySelector('[data-hs-pane="params"]'),
}));
console.log('▸ 就绪：' + JSON.stringify(bothOpen));
if (!bothOpen.timeline || !bothOpen.params) {
    console.log('🔴 需要"轨道 + 参数"两块同屏才能验面板收起（当前不满足）');
    cdp.close();
    process.exit(1);
}

const baselineH = await cdp.call(() => {
    const el = document.querySelector('[data-hs-pane="timeline"]');
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
});

/* ── 场景 A：轨道面板收起（有动效） ───────────────────────────────────── */
await armSampler('[data-hs-pane="timeline"]', 1600);
await closePanel('timeline');
await sleep(900);
const a = await readSampler();
const goneA = await cdp.call(() => !document.querySelector('[data-hs-pane="timeline"]'));

check(
    'E22-X1 面板关闭后**仍在 DOM**（不是当场卸载）且带 `data-hs-leaving`',
    a.leavingFrames > 0 && a.firstLeaving?.present === true,
    `离开帧 ${a.leavingFrames} / 采样 ${a.samples}；首帧 ${JSON.stringify(a.firstLeaving)}`,
);
check(
    'E22-X2 在场期间跑的是 `hs-fade-out`，且确实是**渐变**（中间帧不透明度或动画进度）',
    a.anims.includes('hs-fade-out') && (a.midOpacity > 0 || a.midProgress > 0),
    `anims=${JSON.stringify(a.anims)}；中间不透明度帧 ${a.midOpacity} / 中间进度帧 ${a.midProgress}`,
);
check(
    'E22-X3 离开期间不吃命中（`pointer-events: none`）',
    a.firstLeaving?.pe === 'none',
    `首帧 pointer-events=${a.firstLeaving?.pe}`,
);
check(
    'E22-X4 离开期间**高度没当场塌**（布局等它淡完再收）',
    baselineH > 0 && Math.abs((a.firstLeaving?.h ?? 0) - baselineH) <= 6,
    `关闭前 ${baselineH}px → 首离开帧 ${a.firstLeaving?.h}px（容差 6px）`,
);
check('E22-X5 出场时长走完后节点从 DOM 消失', goneA, `gone=${goneA}；尾帧 ${JSON.stringify(a.tail)}`);

/* ── 场景 B：对照 —— 关掉动效后必须"立即消失"（与改造前逐字节一致） ────── */
await switchTab('timeline');
await cdp.call(() => {
    document.body.setAttribute('data-hs-no-anim', '');
    return true;
});
await sleep(200);
await armSampler('[data-hs-pane="timeline"]', 800);
await closePanel('timeline');
await sleep(600);
const b = await readSampler();
await cdp.call(() => {
    document.body.removeAttribute('data-hs-no-anim');
    return true;
});
check(
    'E22-X6 对照 `body[data-hs-no-anim]`：关闭**立即**消失（无 leaving、无动画）',
    b.leavingFrames === 0 && !b.anims.includes('hs-fade-out'),
    `离开帧 ${b.leavingFrames}；anims=${JSON.stringify(b.anims)}`,
);

/* ── 场景 C：菜单关闭（顶栏菜单；children 是 Fragment ⇒ 走 cloneElement 标记那条路） ── */
await switchTab('params');
const openMenu = await cdp.call(() => {
    const btn = document.querySelector('header button[aria-expanded]');
    if (!btn) return { ok: false, reason: '找不到顶栏菜单按钮' };
    btn.click();
    return { ok: true, label: (btn.textContent || '').trim() };
});
await sleep(600);
const menuOpen = await cdp.call(() => !!document.querySelector('[role="menu"]'));
console.log(`▸ 菜单「${openMenu.label}」打开=${menuOpen}`);
if (!menuOpen) {
    check('E22-X7 菜单关闭出场动画', false, '菜单没打开 ⇒ 判据无法执行（用 click() 而非触摸 tap）');
} else {
    await armSampler('[role="menu"]', 1200);
    await cdp.call(() => {
        const btn = document.querySelector('header button[aria-expanded="true"]');
        if (btn) btn.click();
        else document.querySelector('[role="menu"]')?.parentElement?.querySelector('button')?.click();
        return true;
    });
    await sleep(700);
    const c = await readSampler();
    const goneC = await cdp.call(() => {
        const m = document.querySelector('[role="menu"]');
        return !m || !m.hasAttribute('data-hs-leaving');
    });
    check(
        'E22-X7 菜单（顶栏）关闭后仍在 DOM 且带 leaving、跑 `hs-menu-out`，随后消失',
        c.leavingFrames > 0 && c.anims.includes('hs-menu-out') && goneC,
        `离开帧 ${c.leavingFrames} / 采样 ${c.samples}；anims=${JSON.stringify(c.anims)}；已收口=${goneC}\n     首帧 ${JSON.stringify(c.firstLeaving)}`,
    );
}

console.log(`\n── E22 第二刀（出场动画）汇总：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
