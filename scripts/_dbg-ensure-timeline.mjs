#!/usr/bin/env node
/**
 * 把真机恢复到「时间轴可见」：点顶栏 v 菜单（`mobile_tool_menu` = 绘制工具？不，
 * v 菜单另有其入口）→ 点「轨道面板」。
 *
 * 说明：面板开合在手机端只有 v 菜单里那几个 `menu_view_panel_*` 项
 * （`MobileTopBar` 的 `menu_view`）。所以先开 v 菜单，再点「轨道面板」。
 *
 * 用法：node scripts/_dbg-ensure-timeline.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const snap = () =>
        cdp.call(() => ({
            hasViewport: typeof window.__hsViewport === 'function',
            surface: Boolean(document.querySelector('[data-hs-surface="timeline"]')),
            menuTexts: [...document.querySelectorAll('button')]
                .map((b) => (b.textContent || '').trim())
                .filter((t) => t && t.length < 12)
                .slice(0, 30),
        }));

    console.log('▸ 现状：' + JSON.stringify(await snap()));

    // ① 打开「视图」菜单（面板开合项在 `menu_view` 里）
    const opened = await cdp.call(() => {
        const btns = [...document.querySelectorAll('button')];
        const menu = btns.find((b) => (b.textContent || '').trim() === '视图');
        if (!menu) return { ok: false, labels: btns.map((b) => b.ariaLabel).filter(Boolean).slice(0, 30) };
        menu.click();
        return { ok: true, label: '视图' };
    });
    console.log('▸ 打开 v 菜单：' + JSON.stringify(opened));
    await sleep(700);

    const clicked = await cdp.call(() => {
        const target = [...document.querySelectorAll('button,div,li,span')].find(
            (el) => (el.textContent || '').trim() === '轨道面板',
        );
        if (!target) {
            const all = [...document.querySelectorAll('button')]
                .map((b) => (b.textContent || '').trim())
                .filter((t) => t && t.length < 14);
            return { ok: false, seen: all.slice(0, 40) };
        }
        target.click();
        return { ok: true };
    });
    console.log('▸ 点「轨道面板」：' + JSON.stringify(clicked));
    await sleep(1500);
    console.log('▸ 结果：' + JSON.stringify(await snap()));
    cdp.close();
};

await main();
