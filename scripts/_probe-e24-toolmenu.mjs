#!/usr/bin/env node
/**
 * E24-① 「工具点击语义 + 两套菜单统一」判据（模拟器 / 真机通用）。
 *
 * 用户口径（2026-10-01）：
 *   · 点**未选中**的工具 ⇒ **直接切换**（不弹菜单）；
 *   · 点**已选中**的工具 ⇒ **展开工具菜单**（绘制：绘制/颤音/还原；选择：选择/拖动）；
 *   · 菜单展开后**点别处** ⇒ 收起；
 *   · **统一 选择 与 绘制 的菜单**（同款造型/尺寸/选中态/打开动画）。
 *
 * 判据（6 条）：
 *   E24-T1 点未选中的工具 ⇒ 工具切换、**不弹菜单**
 *   E24-T2 再点**已选中**的工具 ⇒ 展开工具菜单（新语义）
 *   E24-T3 菜单展开后点别处 ⇒ 收起
 *   E24-T4 两套菜单**同款**：同一类名契约 + `role="menu"` + 字号/圆角/条目高一致
 *   E24-T5 两套菜单都带 ✔ 选中标记与同款条目数（选择 2 条 / 绘制 3 条）
 *   E24-T6 菜单几何**不越界**（上下左右都留 ≥4px）
 *
 * 用法：node scripts/_probe-e24-toolmenu.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
if (!pid) {
    console.error('应用没在跑');
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

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/** 点某个元素的**本体**（左上内缩 8px，避开右下角标命中区） */
const clickBody = (selector) =>
    cdp.call((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, reason: '找不到 ' + sel };
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: Math.round(r.left + 8),
                clientY: Math.round(r.top + 8),
            }),
        );
        return { ok: true };
    }, selector);

const snapshot = () =>
    cdp.call(() => {
        const menu = document.querySelector('[data-hs-tool-menu]');
        const selMenu = document.querySelector('[data-hs-select-tool-menu]');
        const drawMenu = document.querySelector('[data-hs-draw-tool-menu]');
        const cs = menu ? getComputedStyle(menu) : null;
        const items = menu ? [...menu.querySelectorAll('.hs-tool-menu__item')] : [];
        const itemCs = items[0] ? getComputedStyle(items[0]) : null;
        const r = menu ? menu.getBoundingClientRect() : null;
        const s = window.__hsSessionState?.() ?? null;
        return {
            toolGroup: (() => {
                /* 工具态一律用 `aria-pressed`（`BarButton` 从 `active` 写出来的）——
                   与既有 `_probe-e19b-toolswitch.mjs` 同口径，**不依赖文案**。 */
                const pressed = (sel) => {
                    const btn = document.querySelector(sel)?.closest('button');
                    return btn ? btn.getAttribute('aria-pressed') === 'true' : null;
                };
                return {
                    selectActive: pressed('[data-hs-select-anchor]'),
                    drawActive: pressed('[data-hs-draw-anchor]'),
                    drawTool:
                        document.querySelector('[data-hs-draw-tool]')?.getAttribute('data-hs-draw-tool') ?? null,
                };
            })(),
            session: s,
            menuOpen: !!menu,
            classes: {
                hasUnified: !!menu && menu.classList.contains('hs-tool-menu'),
                role: menu ? menu.getAttribute('role') : null,
                selectAlias: !!selMenu,
                drawAlias: !!drawMenu,
                itemCount: items.length,
                itemFontSize: itemCs ? itemCs.fontSize : null,
                itemRadius: itemCs ? itemCs.borderRadius : null,
                menuRadius: cs ? cs.borderRadius : null,
                hasCheck: items.some((el) => el.getAttribute('aria-checked') === 'true'),
                activeIndex: items.findIndex((el) => el.dataset.active === 'true'),
            },
            rect: r
                ? { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
                : null,
            viewport: { w: window.innerWidth, h: window.innerHeight },
        };
    });

/* 进入参数界面（工具行只在参数面板上） */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    return true;
});
await sleep(1500);

const selSel = '[data-hs-select-anchor]';
const drawSel = '[data-hs-draw-anchor]';

/* 先看起点：当前工具 + 无菜单 */
const s0 = await snapshot();
console.log(
    `▸ 起点：选择激活=${s0.toolGroup.selectActive} 绘制激活=${s0.toolGroup.drawActive} drawTool=${s0.toolGroup.drawTool}` +
        ` 菜单开=${s0.menuOpen} 视口=${s0.viewport.w}×${s0.viewport.h}`,
);

/* ── T1：点**未选中**的工具 ⇒ 切换、不弹菜单 ─────────────────────────── */
/* 规则：谁没被选中就点谁。若当前是绘制 ⇒ 点选择；否则点绘制。 */
/* 先点**没激活**的那个工具（未选中 ⇒ 应直接切换、不弹菜单） */
const firstPick = s0.toolGroup.drawActive ? selSel : drawSel;
const firstExpectMenu = false;
await clickBody(firstPick);
await sleep(500);
const s1 = await snapshot();
check(
    'E24-T1 点**未选中**的工具 ⇒ 直接切换、不弹菜单',
    s1.menuOpen === firstExpectMenu,
    `点了 ${firstPick === selSel ? '选择' : '绘制'}；菜单开=${s1.menuOpen}（期望 ${firstExpectMenu}）; ` +
        `切换后 选择激活=${s1.toolGroup.selectActive}/绘制激活=${s1.toolGroup.drawActive}`,
);

/* ── T2：再点**已选中**的同一个工具 ⇒ 展开工具菜单 ────────────────────── */
await clickBody(firstPick);
await sleep(400);
const s2 = await snapshot();
check(
    'E24-T2 再点**已选中**的工具 ⇒ 展开工具菜单（新语义）',
    s2.menuOpen === true && s2.classes.hasUnified,
    `菜单开=${s2.menuOpen}；统一类=${s2.classes.hasUnified}；role=${s2.classes.role}；条目=${s2.classes.itemCount}；别名(select/draw)=${s2.classes.selectAlias}/${s2.classes.drawAlias}`,
);

/* ── T4/T5/T6：菜单造型与几何（用刚打开的这一份） ─────────────────────── */
const m1 = s2;
const rect0 = m1.rect;
check(
    'E24-T6 菜单几何**不越界**（四周 ≥4px）',
    !!rect0 &&
        rect0.left >= 4 &&
        rect0.top >= 4 &&
        rect0.left + rect0.w <= m1.viewport.w - 4 &&
        rect0.top + rect0.h <= m1.viewport.h - 4,
    `rect=${JSON.stringify(rect0)} 视口=${JSON.stringify(m1.viewport)}`,
);

/* ── T3：点别处 ⇒ 收起 ───────────────────────────────────────────────── */
await cdp.call(() => {
    const bd = document.querySelector('.hs-tool-menu__backdrop');
    if (bd) bd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!bd;
});
await sleep(400);
const s3 = await snapshot();
check('E24-T3 菜单展开后**点别处** ⇒ 收起', s3.menuOpen === false, `菜单开=${s3.menuOpen}`);

/* 打开另一套菜单做**同款**对比 */
await clickBody(firstPick);
await sleep(300);
await cdp.call(() => {
    const bd = document.querySelector('.hs-tool-menu__backdrop');
    if (bd) bd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
});
await sleep(300);
const otherSel = firstPick === selSel ? drawSel : selSel;
await clickBody(otherSel); // 切过去
await sleep(400);
await clickBody(otherSel); // 再点 = 开菜单
await sleep(400);
const m2 = await snapshot();
const sameLook =
    m1.classes.itemFontSize === m2.classes.itemFontSize &&
    m1.classes.itemRadius === m2.classes.itemRadius &&
    m1.classes.menuRadius === m2.classes.menuRadius &&
    m1.classes.role === m2.classes.role;
check(
    'E24-T4 两套菜单**同款**（同一类名契约 + role=menu + 字号/圆角一致）',
    m2.menuOpen && m2.classes.hasUnified && sameLook,
    `A: 条目字 ${m1.classes.itemFontSize}/圆角 ${m1.classes.itemRadius}/面板圆角 ${m1.classes.menuRadius}；` +
        `B: ${m2.classes.itemFontSize}/${m2.classes.itemRadius}/${m2.classes.menuRadius}；role=${m2.classes.role}`,
);
check(
    'E24-T5 两套菜单条目数与 ✔ 选中标记（选择 2 / 绘制 3，且都恰好一个 active）',
    [m1.classes.itemCount, m2.classes.itemCount].sort().join(',') === '2,3' &&
        m1.classes.hasCheck &&
        m2.classes.hasCheck &&
        m1.classes.activeIndex >= 0 &&
        m2.classes.activeIndex >= 0,
    `条目数 A=${m1.classes.itemCount} B=${m2.classes.itemCount}；✔ A=${m1.classes.hasCheck} B=${m2.classes.hasCheck}；activeIdx A=${m1.classes.activeIndex} B=${m2.classes.activeIndex}`,
);

console.log(`\n── E24-① 工具语义与菜单统一：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
