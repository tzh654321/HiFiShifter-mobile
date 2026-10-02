/**
 * E31 长按互斥判据（2026-10-02，用户口径）——
 *
 * > 「长按与长按并划动时常出现同时触发的情况，修法是长按操作**松手时才生效**
 * >   （如**调增益与轨道头长按菜单同时出现**）」
 *
 * 真因（代码级）：轨道头的 `contextmenu` 守卫只在 `touchHold` 非空时生效，
 * 而**起手落在旋钮/按钮上时 `touchstart` 候选会早退** ⇒ `touchHold` 恒为 null
 * ⇒ 浏览器在长按 ~500ms 派发的 `contextmenu` 直接开菜单，**同时**增益旋钮的拖动
 * （260ms 已武装）在跑 ⇒ 两条功能一起生效。
 *
 * 🕳️ 判据为什么要"合成 contextmenu"：CDP 的 `Input.dispatchTouchEvent` 长按**不保证**
 * 让 WebView 合成原生 `contextmenu`。若只靠真实长按，这条判据在能复现和不能复现时
 * 都是"通过"，属于**空转判据**。这里直接派发 `contextmenu`（React 走 root 委托，
 * 与真实事件同一条链路）⇒ 判的是**守卫本身**，与浏览器是否合成长按无关。
 *
 * 用法：node scripts/_probe-e31-longpress-arb.mjs <serial>
 */
import { Cdp } from './lib/cdp.mjs';
import { execSync } from 'node:child_process';

const serial = process.argv[2] ?? process.env.ANDROID_SERIAL ?? 'emulator-5554';
const PKG = 'com.arounder.hifishifter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args) => execSync(`adb -s ${serial} ${args}`, { encoding: 'utf8' }).replace(/\r/g, '');

const pid = adb(`shell pidof ${PKG}`).trim();
if (!pid) {
    console.log('🔴 应用没在跑');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}`);
    if (detail !== undefined) console.log(`     ${detail}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* ── 0. 前置：有轨道行 + 增益旋钮 ─────────────────────────────────── */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    return true;
});
await sleep(2500);
const geo = await cdp.call(() => {
    const row = document.querySelector('[data-hs-track-row]');
    const knob = document.querySelector('[data-track-volume-knob]');
    if (!row || !knob) return null;
    const kb = knob.getBoundingClientRect();
    const rb = row.getBoundingClientRect();
    const interactive = (el) =>
        Boolean(
            el &&
                el.closest(
                    "button,[role='slider'],[role='button'],input,textarea,select,a,[data-hs-interactive]",
                ),
        );
    /* 行内找一个"不落在交互控件上"的空白点，用于对照组。 */
    let blank = null;
    for (let dx = 8; dx < rb.width - 8 && blank === null; dx += 6) {
        const x = Math.round(rb.left + dx);
        const y = Math.round(rb.top + rb.height / 2);
        const el = document.elementFromPoint(x, y);
        if (el && !interactive(el) && el.closest('[data-hs-track-row]') === row) blank = { x, y };
    }
    return {
        row: { x: Math.round(rb.left), y: Math.round(rb.top), w: Math.round(rb.width), h: Math.round(rb.height) },
        knob: {
            x: Math.round(kb.left + kb.width / 2),
            y: Math.round(kb.top + kb.height / 2),
            label: knob.getAttribute('aria-label') ?? '',
        },
        blank,
    };
});
console.log('▸ 前置：' + JSON.stringify(geo));
if (!geo || !geo.blank) {
    console.log('🔴 前置不满足（没有轨道行/旋钮/空白点）');
    cdp.close();
    process.exit(1);
}

const menuOpen = () =>
    cdp.call(() => Boolean(document.querySelector('[data-track-ctx-menu]')));

const dispatchCtxMenu = (x, y) =>
    cdp.call(
        (px, py) => {
            const el = document.elementFromPoint(px, py);
            if (!el) return false;
            el.dispatchEvent(
                new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: px,
                    clientY: py,
                }),
            );
            return true;
        },
        x,
        y,
    );

const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });

/* ── 1. 对照组：空白处 contextmenu ⇒ 菜单**应该**出来 ─────────────── */
await dispatchCtxMenu(geo.blank.x, geo.blank.y);
await sleep(400);
const blankMenu = await menuOpen();
check(
    'E31-A 对照组：轨道行**空白处**的 contextmenu ⇒ 轨道菜单正常弹出',
    blankMenu === true,
    `menu=${blankMenu}（点=(${geo.blank.x},${geo.blank.y})）`,
);
/* 关掉菜单（点别处） */
if (blankMenu) {
    await cdp.call(() => {
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        return true;
    });
    await sleep(400);
}

/* ── 2. 关键：旋钮上**长按中**的 contextmenu ⇒ 菜单**不许**弹出 ───── */
await touch('touchStart', [{ x: geo.knob.x, y: geo.knob.y }]);
await sleep(700); // 过 260ms 增益门槛（也过 450/500）
await dispatchCtxMenu(geo.knob.x, geo.knob.y);
await sleep(350);
const menuDuringKnob = await menuOpen();
check(
    'E31-B 增益旋钮**长按中**的 contextmenu ⇒ 轨道菜单**不出现**（互斥）',
    menuDuringKnob === false,
    `menu=${menuDuringKnob}（长按点=(${geo.knob.x},${geo.knob.y}) label=${
        (await cdp.call(() => document.querySelector('[data-track-volume-knob]')?.getAttribute('aria-label') ?? '')
    )}）`,
);

/* 顺手确认增益拖动仍然活着：纵向划动 ⇒ 旋钮 tooltip 变化 */
const labelBefore = await cdp.call(
    () => document.querySelector('[data-track-volume-knob]')?.getAttribute('aria-label') ?? '',
);
for (let i = 1; i <= 6; i += 1) {
    await touch('touchMove', [{ x: geo.knob.x, y: geo.knob.y - i * 6 }]);
    await sleep(40);
}
const labelAfter = await cdp.call(
    () => document.querySelector('[data-track-volume-knob]')?.getAttribute('aria-label') ?? '',
);
await touch('touchEnd', []);
await sleep(300);
check(
    'E31-C 长按后纵向划动 ⇒ 增益**真的变了**（互斥不能把增益拖动一起掐死）',
    labelBefore !== labelAfter,
    `before=${JSON.stringify(labelBefore)} after=${JSON.stringify(labelAfter)}`,
);

/* 收尾：抬指后菜单仍不出现 */
const menuAfterUp = await menuOpen();
check('E31-D 抬手后菜单仍未出现', menuAfterUp === false, `menu=${menuAfterUp}`);

console.log(`\n── E31 长按互斥：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
