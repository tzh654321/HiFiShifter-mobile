#!/usr/bin/env node
/**
 * D4 验收：**长按轨道出现的菜单**应与**菜单栏-轨道**同步（同一批条目）。
 *
 * 用户口径：「长按轨道出现的菜单 向 菜单栏-轨道 同步」。
 * 判据：两处菜单的条目文案集合一致（忽略分隔线；允许顺序不同）。
 *
 * 用法：node scripts\_probe-track-menu-sync.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    const closeMenus = () =>
        cdp.call(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            document.body.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }),
            );
        });

    // ① 菜单栏「轨道」菜单
    await closeMenus();
    await sleep(500);
    const topMenu = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const trigger = [...document.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === '轨道',
        );
        if (!trigger) return { error: 'no-track-menu' };
        trigger.click();
        await wait(700);
        const pop = document.querySelector('[role="menu"], [data-radix-popper-content-wrapper]');
        if (!pop) return { error: 'no-popup' };
        const items = [...pop.querySelectorAll('[role="menuitem"], button, [role="menuitemcheckbox"], [role="menuitemradio"]')]
            .map((el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '))
            .filter((t) => t.length > 0 && t.length < 24);
        return { items: [...new Set(items)] };
    });
    console.log('▸ 菜单栏-轨道：' + JSON.stringify(topMenu));

    // ② 长按轨道行 → 轨道菜单
    await closeMenus();
    await sleep(600);
    const ctxMenu = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const row = document.querySelectorAll('[data-hs-track-row]')[0];
        if (!row) return { error: 'no-row' };
        const b = row.getBoundingClientRect();
        row.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: b.left + 24,
                clientY: b.top + b.height * 0.5,
            }),
        );
        await wait(700);
        const menu = document.querySelector('[data-track-ctx-menu]');
        if (!menu) return { error: 'no-ctx-menu' };
        const items = [...menu.querySelectorAll('button')]
            .map((el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '))
            .filter((t) => t.length > 0);
        return { items: [...new Set(items)] };
    });
    console.log('▸ 长按轨道菜单：' + JSON.stringify(ctxMenu));
    await closeMenus();

    const top = (topMenu.items ?? []).map((t) => t.replace(/\s+/g, ''));
    const ctx = (ctxMenu.items ?? []).map((t) => t.replace(/\s+/g, ''));
    const missingInCtx = top.filter((t) => !ctx.some((c) => c.startsWith(t) || t.startsWith(c)));
    const missingInTop = ctx.filter((t) => !top.some((c) => c.startsWith(t) || t.startsWith(c)));

    check(
        'D4-a 长按轨道菜单包含菜单栏-轨道的**全部条目**',
        top.length > 0 && ctx.length > 0 && missingInCtx.length === 0,
        `菜单栏=${JSON.stringify(top)}；长按=${JSON.stringify(ctx)}；长按缺=${JSON.stringify(missingInCtx)}`,
    );
    check(
        'D4-b 长按轨道菜单没有菜单栏之外的**多余功能项**（算法项允许额外，见注释）',
        missingInTop.filter((t) => !/world|hifigan|vslib|无/.test(t)).length === 0,
        `长按多出=${JSON.stringify(missingInTop)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
