#!/usr/bin/env node
/**
 * 移动端 i18n 收尾的**设备回归判据**。
 *
 * 本轮把 `MobileBottomBar` / `MobileTopBar` 里最后一批硬编码中文改成 `t(...)`：
 *   · MobileBottomBar：`覆盖层` / `同步位置` / 参数兜底标签（PARAM_TABS 6 项，改走 i18n 键）
 *   · MobileTopBar：`模型管理…` / `文件面板`(复用 `file_panel`) / `笔记面板` / `关闭菜单` / `‹ 返回` / `菜单整理中`
 * 新增 7 个键（`mobile_overlay_section`/`mobile_sync_position`/`mobile_model_manager`/
 * `mobile_notes_panel`/`mobile_close_menu`/`mobile_back`/`mobile_menu_organizing`）到 5 个语系。
 *
 * 【为什么要设备跑】`t()` 的实现是 `localeMessages[key] ?? messages["en-US"][key]` ——
 * **键名写错不会报错**（tsc 只认 en-US 的联合类型，其它语系缺键会静默回退英文）。
 * 所以必须在真界面上确认：① 文案在位；② 没有 `undefined` 之类的空洞文本。
 *
 * 判据：
 *   i18n-1 👁「参数与覆盖层」面板里出现「覆盖层」「同步位置」
 *   i18n-2 逐个打开顶栏 6 个菜单：**菜单文本不含 undefined / null / NaN**
 *   i18n-3 全页可见文本不含 `undefined` / `[object Object]`
 *
 * 用法：node scripts/_probe-i18n-mobile.mjs [serial]
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
const tap = async (x, y, hold = 70) => {
    await touch('touchStart', [{ x, y }]);
    await sleep(hold);
    await touch('touchEnd', []);
    await sleep(800);
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    await new Promise((r) => setTimeout(r, 3200));
});

/* ── i18n-1：👁 面板里的两条固定文案 ───────────────────────────── */
/* ⚠️ 同一类坑：这个入口用 CDP 的**触摸 tap 打不开**（坐标命中、`display:flex`、按钮在位，
   但点了没反应），`el.click()` 立刻打开。本节只验"文案是否在位"，不验手势 ⇒ 用 click。 */
const EYE_LABEL = '参数与覆盖层';
const eyeState = await cdp.call((label) => {
    const isOpen = () =>
        [...document.querySelectorAll('[role="menu"]')].some(
            (e) => e.getAttribute('aria-label') === label,
        );
    const already = isOpen();
    if (!already) document.querySelector(`button[aria-label="${label}"]`)?.click();
    return { already, hasButton: Boolean(document.querySelector(`button[aria-label="${label}"]`)) };
}, EYE_LABEL);
if (eyeState.hasButton) {
    await sleep(900);
    const panel = await cdp.call((label) => {
        const el = [...document.querySelectorAll('[role="menu"]')].find(
            (e) => e.getAttribute('aria-label') === label,
        );
        return el ? (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260) : null;
    }, EYE_LABEL);
    check(
        'i18n-1 👁 面板里「覆盖层」「同步位置」都在位',
        Boolean(panel && panel.includes('覆盖层') && panel.includes('同步位置')),
        'panel=' + JSON.stringify(panel) + '（进入时已开=' + eyeState.already + '）',
    );
    /* 只在"本步骤自己打开"时才收起（👁 是 toggle，重复点会反效果）。 */
    if (!eyeState.already) {
        await cdp.call((label) => {
            document.querySelector(`button[aria-label="${label}"]`)?.click();
        }, EYE_LABEL);
        await sleep(400);
    }
} else {
    check('i18n-1 👁 面板里「覆盖层」「同步位置」都在位', false, '找不到 👁 按钮');
}

/* ── i18n-2：逐个打开顶栏菜单，检查有没有空洞文本 ────────────────── */
/* ⚠️ 顶栏菜单按钮只能用 `el.click()` 打开：实测 CDP 的**触摸 tap 打不开**
   （`elementFromPoint(27,22)` 确实命中那个 button、`aria-expanded` 也不变），
   而同一元素 `click()` 立刻开菜单。这里是"检查文案"不是"测手势"，用 click 无妨。 */
const menuCount = await cdp.call(() => document.querySelectorAll('header button[aria-expanded]').length);
console.log('▸ 顶栏菜单按钮数：' + menuCount);
const badTexts = [];
const seenMenus = [];
for (let i = 0; i < menuCount; i += 1) {
    const info = await cdp.call((idx) => {
        const b = [...document.querySelectorAll('header button[aria-expanded]')][idx];
        if (!b) return { skip: true };
        b.click();
        return { skip: false, label: (b.innerText || '').trim() };
    }, i);
    if (info.skip) continue;
    await sleep(420);
    const read = await cdp.call((label) => {
        /* 排除 👁 面板（它也带 `role=menu` + 自己的 aria-label），否则会读到它。 */
        const candidates = [...document.querySelectorAll('[role="menu"]')].filter(
            (e) => e.getAttribute('aria-label') !== label,
        );
        const menu = candidates.pop();
        const txt = (menu?.innerText || '').replace(/\s+/g, ' ').trim();
        return { txt: txt.slice(0, 240), bad: /undefined|null|NaN|\[object /i.test(txt) };
    }, EYE_LABEL);
    seenMenus.push(info.label + ': ' + read.txt.slice(0, 70));
    if (read.bad) badTexts.push({ menu: info.label, txt: read.txt });
    /* 用菜单自己的 backdrop 收起（那个 aria-label 正是本轮 i18n 过的 key）。 */
    await cdp.call(() => {
        const bk = [...document.querySelectorAll('button[aria-label]')].find(
            (b) => b.className.includes('fixed') && b.style.inset === '0px',
        );
        if (bk) bk.click();
        else [...document.querySelectorAll('header button[aria-expanded]')].forEach((b) => {
            if (b.getAttribute('aria-expanded') === 'true') b.click();
        });
    });
    await sleep(320);
}
check(
    `i18n-2 顶栏 ${menuCount} 个菜单文本无空洞（undefined/null/NaN）`,
    badTexts.length === 0,
    badTexts.length
        ? JSON.stringify(badTexts.slice(0, 3))
        : '样例：' + JSON.stringify(seenMenus.slice(0, 3)),
);

/* ── i18n-3：全页扫描 ─────────────────────────────────────────── */
const pageBad = await cdp.call(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ');
    const hits = [];
    for (const kw of ['undefined', '[object Object]', 'NaN']) {
        if (t.includes(kw)) hits.push(kw);
    }
    return { hits, sample: t.slice(0, 160) };
});
check(
    'i18n-3 全页可见文本无 `undefined` / `[object Object]` / `NaN`',
    pageBad.hits.length === 0,
    JSON.stringify(pageBad),
);

console.log(`\n── i18n 汇总：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
