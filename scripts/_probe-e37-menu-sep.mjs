#!/usr/bin/env node
/**
 * E37 判据 —— 顶栏菜单里**不得出现相邻的两条分隔线**（用户 2026-10-03 口径：
 * 「存储设置、工程设置 选项下方**无需双横线，只需要单横线**」）。
 *
 * 修前根因：`MobileTopBar.tsx` 的菜单项数组里写了**相邻两条** `{ sep: true, label: "" }`
 * —— 文件菜单（工程设置下方）与选项菜单（存储设置下方）各一处 ⇒ 渲染成"双横线"。
 *
 * 判定：逐个打开六个顶层菜单，把 `[role=menu]` 的**直接子元素**分类成
 * `sep`（分隔线 = `div`）/ `item`（菜单项 = `button`），检查**不存在相邻两个 sep**。
 *
 * 用法：node scripts/_probe-e37-menu-sep.mjs [serial]
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
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

/** 顶栏那六个按钮（`header` 里的 menubar 按钮）。 */
const menuButtons = () =>
    cdp.call(() =>
        [...document.querySelectorAll('header button[aria-expanded]')].map((b, i) => ({
            i,
            label: (b.textContent ?? '').trim(),
        })),
    );

/** 打开第 i 个菜单（**只能用 `el.click()`** —— 顶栏菜单吃不了合成触摸 tap）。 */
const openMenu = (i) =>
    cdp.call((idx) => {
        const btns = [...document.querySelectorAll('header button[aria-expanded]')];
        const b = btns[idx];
        if (!b) return null;
        b.click();
        return (b.textContent ?? '').trim();
    }, i);

/** 读当前打开的菜单：把直接子元素分类，数出最长的连续分隔线长度。 */
const readMenu = () =>
    cdp.call(() => {
        const panel = document.querySelector('header [role="menu"]');
        if (!panel) return null;
        const kinds = [...panel.children].map((el) =>
            el.tagName === 'BUTTON' ? 'item' : el.tagName === 'DIV' ? 'sep' : 'other',
        );
        let run = 0;
        let maxRun = 0;
        for (const k of kinds) {
            if (k === 'sep') {
                run += 1;
                if (run > maxRun) maxRun = run;
            } else {
                run = 0;
            }
        }
        return {
            kinds,
            seps: kinds.filter((k) => k === 'sep').length,
            items: kinds.filter((k) => k === 'item').length,
            maxRun,
        };
    });

const closeMenu = () =>
    cdp.call(() => {
        const b = document.querySelector('header button[aria-expanded="true"]');
        if (b) b.click();
        return true;
    });

const btns = await menuButtons();
console.log(`▸ 顶层菜单：${btns.map((b) => b.label).join(' · ')}\n`);

for (const b of btns) {
    await closeMenu();
    await sleep(120);
    const label = await openMenu(b.i);
    await sleep(420);
    const m = await readMenu();
    if (m === null) {
        check(`E37-S${b.i} 「${b.label}」菜单打开`, false, '菜单面板没渲染');
        continue;
    }
    check(
        `E37-S${b.i} 「${b.label}」菜单：**无相邻分隔线**（项 ${m.items} / 分隔 ${m.seps}）`,
        m.maxRun <= 1,
        `kinds=[${m.kinds.join(',')}] 最长连续分隔=${m.maxRun}`,
    );
    await closeMenu();
    await sleep(160);
}

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== E37 菜单分隔线：通过 ${pass} / ${results.length} ===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
