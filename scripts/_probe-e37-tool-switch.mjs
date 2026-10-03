#!/usr/bin/env node
/**
 * E37 判据 —— 工具按钮的**点击语义**（用户 2026-10-03 口径，原话）：
 *   「点击**未选择**的工具后直接切换，点击**选择中**的工具展开工具菜单
 *     （例如现在的模式是拖动，未点开任何弹出，现在点击绘制，正确的情况是
 *      **直接切换到绘制**，而不是打开 绘制/颤音/还原 的菜单）」
 *
 * 修前真因：`MobileBottomBar.tsx` 的 `onPencilClick` 里有一句**几何式角标判定**
 *   `inCorner = e.clientX >= r.right - 18 && e.clientY >= r.bottom - 18`
 * ——本意是"点右下角那个小三角 = 我要菜单"，但按钮只有 ~32px 高，右下 18×18 已经吃掉
 * 整个按钮的一大块 ⇒ 点在图标上稍偏右下就被判成"点角标"⇒ 菜单抢在切换之前弹出。
 * （「选择」那个按钮早就去掉了这句，两个按钮语义不一致。）
 *
 * 判据：
 *   E37-T1 当前**非**绘制态：点「绘制」按钮**本体**（中心） ⇒ **直接切换**、**不**弹工具菜单
 *   E37-T2 切换后确实是绘制态（按钮 `aria-pressed`）
 *   E37-T3 当前**已是**绘制态：再点「绘制」本体 ⇒ **展开工具菜单**（用户明确要的语义）
 *   E37-T4 「选择」按钮同规：非选中态点本体 ⇒ 直接切换、不弹菜单
 *   E37-T5 角标（`[data-hs-draw-corner]`）**仍然**能开菜单（那条明确手势不能丢）
 *
 * 用法：node scripts/_probe-e37-tool-switch.mjs [serial]
 * 前置：参数面板已打开（工具行 `[data-hs-draw-anchor]` 只在那时渲染）。
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
const skipped = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};
const skip = (name, why) => {
    skipped.push(name);
    console.log(`⬜ ${name}\n     不可判：${why}`);
};

/** 打开参数面板（工具行只在它存在时渲染）。 */
const openParams = () =>
    cdp.call(() => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        return true;
    });

/** 读工具态：`aria-pressed` 取按钮（与既有探针同口径，不依赖文案）。 */
const state = () =>
    cdp.call(() => {
        const pressed = (sel) => {
            const el = document.querySelector(sel);
            const btn = el ? el.closest('button') : null;
            return btn ? btn.getAttribute('aria-pressed') === 'true' : null;
        };
        const anchor = document.querySelector('[data-hs-draw-anchor]');
        const ab = anchor ? anchor.closest('button') : null;
        const ar = ab ? ab.getBoundingClientRect() : null;
        const sb = document.querySelector('[data-hs-select-anchor]')?.closest('button') ?? null;
        const sr = sb ? sb.getBoundingClientRect() : null;
        return {
            drawActive: pressed('[data-hs-draw-anchor]'),
            selectActive: pressed('[data-hs-select-anchor]'),
            drawTool: anchor ? anchor.getAttribute('data-hs-draw-tool') : null,
            menuOpen: Boolean(document.querySelector('[data-hs-tool-menu]')),
            drawBtn: ar ? { cx: Math.round(ar.left + ar.width / 2), cy: Math.round(ar.top + ar.height / 2), w: Math.round(ar.width), h: Math.round(ar.height), right: Math.round(ar.right), bottom: Math.round(ar.bottom) } : null,
            selBtn: sr ? { cx: Math.round(sr.left + sr.width / 2), cy: Math.round(sr.top + sr.height / 2) } : null,
        };
    });

/** 点按钮**本体**：用真实鼠标事件落在**中心**（正好能检验原来那句几何角标判定）。 */
const clickBody = (sel) => clickAt(sel, 0, 0);

/**
 * 在按钮的"中心 + 偏移"处点击。
 *
 * 🔴 为什么要这个：按钮实测 **40×40**，而旧代码的角标判定是"右下 18×18"
 * ⇒ 中心点(58,200) **不在**角区（角区从 x≥60、y≥202 起），所以只点中心**测不出**用户那个 bug。
 * 手指落在图标上时通常会偏右下（视觉图标只有 16×16，整块按钮 40×40）——
 * 偏移点击才是用户的真实复现路径。
 */
const clickAt = (sel, dx, dy) =>
    cdp.call(
        (s, ox, oy) => {
            const el = document.querySelector(s);
            const btn = el ? el.closest('button') : null;
            if (!btn) return { ok: false, reason: '找不到按钮 ' + s };
            const r = btn.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2 + ox);
            const y = Math.round(r.top + r.height / 2 + oy);
            btn.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
            );
            return {
                ok: true,
                x,
                y,
                w: Math.round(r.width),
                h: Math.round(r.height),
                inOldCornerZone: x >= r.right - 18 && y >= r.bottom - 18,
            };
        },
        sel,
        dx,
        dy,
    );

/** 点角标元素本身（`[data-hs-draw-corner]` 有自己的 onClick）。 */
const clickCorner = () =>
    cdp.call(() => {
        const corner = document.querySelector('[data-hs-draw-corner]');
        if (!corner) return false;
        corner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
    });

const closeMenu = () =>
    cdp.call(() => {
        document.body.click();
        const bd = document.querySelector('.hs-tool-menu__backdrop');
        if (bd) bd.click();
        return true;
    });

await openParams();
await sleep(700);

let s = await state();
console.log(`▸ 初始：drawActive=${s.drawActive} selectActive=${s.selectActive} drawTool=${s.drawTool} 按钮=${JSON.stringify(s.drawBtn)}\n`);
if (s.drawBtn === null) {
    console.error('🔴 找不到工具行（参数面板没打开？）');
    cdp.close();
    process.exit(1);
}

/* ── T1/T2：先退到「选择」态，再点绘制本体 ───────────────────────────── */
if (s.drawActive === true) {
    /* 先切到选择（点选择本体；旧代码下这里可能弹菜单，无所谓，只为造出"非绘制态"） */
    await clickBody('[data-hs-select-anchor]');
    await sleep(400);
    await closeMenu();
    await sleep(300);
}
s = await state();
const wasDrawActive = s.drawActive;
const r1 = await clickBody('[data-hs-draw-anchor]');
await sleep(600);
let after = await state();
check(
    'E37-T1 非绘制态点「绘制」**本体** ⇒ 直接切换、**不**弹工具菜单',
    after.menuOpen === false && after.drawActive === true,
    `点击点=(${r1.x},${r1.y}) 按钮=${JSON.stringify(s.drawBtn)}\n     切换后 drawActive=${after.drawActive} menuOpen=${after.menuOpen}（修前：menuOpen=true、drawActive 仍为 ${wasDrawActive}）`,
);
check(
    'E37-T2 切换后确实进入绘制态（按钮 `aria-pressed` + 绘制工具名）',
    after.drawActive === true && after.drawTool !== null,
    `drawActive=${after.drawActive} drawTool=${after.drawTool}`,
);

/* ── T1b：**用户真实复现路径** —— 手指偏右下（旧代码的角区）仍然必须"直接切换" ── */
{
    /* 先切回"非绘制态" */
    await clickBody('[data-hs-select-anchor]');
    await sleep(500);
    await closeMenu();
    await sleep(300);
    const before1b = await state();
    const r1b = await clickAt('[data-hs-draw-anchor]', 8, 8);
    await sleep(600);
    const after1b = await state();
    check(
        'E37-T1b 手指**偏右下**（旧代码角区）点「绘制」⇒ 仍须直接切换、不弹菜单',
        after1b.menuOpen === false && after1b.drawActive === true,
        `点击点=(${r1b.x},${r1b.y}) 落进旧角区=${r1b.inOldCornerZone}（按钮 ${r1b.w}×${r1b.h}）\n     切换前 drawActive=${before1b.drawActive} → 切换后 drawActive=${after1b.drawActive} menuOpen=${after1b.menuOpen}`,
    );
    await closeMenu();
    await sleep(250);
}

/* ── T3：已是绘制态 ⇒ 点本体应开菜单 ─────────────────────────────────── */
await closeMenu();
await sleep(300);
await clickBody('[data-hs-draw-anchor]');
await sleep(600);
after = await state();
check(
    'E37-T3 **已选中**的绘制工具点本体 ⇒ 展开工具菜单（用户明确要的语义）',
    after.menuOpen === true,
    `menuOpen=${after.menuOpen}（期望 true）`,
);
await closeMenu();
await sleep(300);

/* ── T4：「选择」同规 ───────────────────────────────────────────────── */
await clickBody('[data-hs-select-anchor]');
await sleep(500);
let st2 = await state();
if (st2.selectActive === true && st2.menuOpen === false) {
    /* 已经是选择态了，先切到绘制（点绘制本体），再回来点选择本体 */
    await clickBody('[data-hs-draw-anchor]');
    await sleep(400);
    await closeMenu();
    await sleep(200);
    st2 = await state();
}
if (st2.drawActive !== true) {
    skip('E37-T4 非选中态点「选择」本体 ⇒ 直接切换、不弹菜单', `前置未成立：drawActive=${st2.drawActive}`);
} else {
    await clickBody('[data-hs-select-anchor]');
    await sleep(600);
    const st3 = await state();
    check(
        'E37-T4 非绘制/非选择态点「选择」**本体** ⇒ 直接切换、**不**弹菜单',
        st3.selectActive === true && st3.menuOpen === false,
        `selectActive=${st3.selectActive} menuOpen=${st3.menuOpen}`,
    );
    await closeMenu();
    await sleep(250);
}

/* ── T5：角标那条明确手势仍然可用 ───────────────────────────────────── */
const cornerOk = await clickCorner();
await sleep(600);
after = await state();
check(
    'E37-T5 点**角标**（`[data-hs-draw-corner]`）仍然展开工具菜单（明确手势不能丢）',
    cornerOk && after.menuOpen === true,
    `cornerClicked=${cornerOk} menuOpen=${after.menuOpen}`,
);

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== E37 工具按钮点击语义：通过 ${pass} / ${results.length}（另有 ${skipped.length} 条不可判）===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
for (const n of skipped) console.log(`⬜ ${n}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
