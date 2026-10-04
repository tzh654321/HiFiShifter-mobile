#!/usr/bin/env node
/**
 * E41-4b 验收：**手机外壳的 CSS 断点必须跟 `resolveLayoutMode` 同口径（< 1280 ⇒ phone）**。
 *
 * 用户口径（2026-10-04 手测）：「**横屏下参数界面左上角没有叉**」。
 * 根因：`index.css` 里 `.hs-param-close` 只写在 `@media (max-width: 599px)`，
 * 而**横屏手机宽 ≈752** ⇒ 不成立 ⇒ 整个叉被隐藏（`.hs-panel-close` 的
 * `@media (min-width: 600px) { display:none }` 同理）。
 *
 * 判据：往 body 注入同 class 的元素，读 `computed display`，在三种宽度下断言：
 *   360（竖屏）→ 都要显示 · 752（**横屏手机**）→ 都要显示 · 1400（桌面）→ 都不显示。
 * ⇒ 用 CDP 视口覆盖制造宽度，**不动设备的自动旋转**。
 *
 * 用法：node scripts/_probe-e41-shell-breakpoint.mjs [--serial 221deeb]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
for (let i = 2; i < argv.length; i++) if (argv[i] === '--serial') serial = argv[++i];

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifisher 2>/dev/null || adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!pid) throw new Error('应用没在跑');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

/** 注入同 class 元素读 computed display（绕过"元素当前不存在"的问题）。 */
const readDisplay = () =>
    cdp.call(() => {
        const mk = (cls) => {
            const el = document.createElement('button');
            el.className = cls;
            document.body.appendChild(el);
            const cs = getComputedStyle(el);
            const out = { display: cs.display, visibility: cs.visibility };
            el.remove();
            return out;
        };
        return {
            paramClose: mk('hs-param-close'),
            panelClose: mk('hs-panel-close'),
            menuShortcut: (() => {
                const el = document.createElement('span');
                el.className = 'hs-menu-shortcut';
                document.body.appendChild(el);
                const cs = getComputedStyle(el);
                const out = { display: cs.display };
                el.remove();
                return out;
            })(),
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    });

const setViewport = async (w, h) => {
    if (w === null) {
        await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    } else {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: w,
            height: h,
            deviceScaleFactor: 2,
            mobile: true,
        });
    }
    await sleep(900);
};

/* ── 1. 竖屏（真实视口 360×708）───────────────────────────────────────── */
await setViewport(null);
const portrait = await readDisplay();
check(
    'P1 竖屏（360）：参数界面叉 / 分屏面板叉 都应显示',
    portrait.paramClose.display !== 'none' && portrait.panelClose.display !== 'none',
    JSON.stringify(portrait),
);

/* ── 2. 横屏手机（752×360）——**本条就是用户报的现场** ─────────────────── */
await setViewport(752, 360);
const land = await readDisplay();
check(
    'L1 横屏手机（752×360）：**参数界面左上角的叉必须显示**（修复前 `max-width:599` ⇒ 被隐藏）',
    land.paramClose.display !== 'none',
    `hs-param-close.display=${land.paramClose.display}  vw=${land.vw}`,
);
check(
    'L2 横屏手机（752）：分屏面板左上角的叉也必须显示（`min-width:600 ⇒ display:none` 那条已改 1280）',
    land.panelClose.display !== 'none',
    `hs-panel-close.display=${land.panelClose.display}`,
);
check(
    'L3 横屏手机（752）：键盘快捷键提示仍应隐藏（它也在 `max-width:599` 里）',
    land.menuShortcut.display === 'none',
    `hs-menu-shortcut.display=${land.menuShortcut.display}（期望 none）`,
);

/* ── 3. 桌面（1400）——叉应当不显示（桌面上没有"关闭面板"语义）───────── */
await setViewport(1400, 800);
const desk = await readDisplay();
check(
    'D1 桌面（1400）：参数叉 / 面板叉都应隐藏（与 `resolveLayoutMode` 的 `≥1280 ⇒ desktop` 对齐）',
    desk.paramClose.display === 'none' && desk.panelClose.display === 'none',
    JSON.stringify(desk),
);
check(
    'D2 桌面（1400）：快捷键提示应显示（`hs-menu-shortcut` 只在手机外壳隐藏）',
    desk.menuShortcut.display !== 'none',
    `hs-menu-shortcut.display=${desk.menuShortcut.display}`,
);

await setViewport(null);
const back = await cdp.call(() => ({ vw: window.innerWidth }));
check('N9 收尾：视口覆盖已清除', back.vw < 1280, JSON.stringify(back));

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 手机外壳 CSS 断点探针：通过 ${pass} / ${results.length} ===`);
for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
