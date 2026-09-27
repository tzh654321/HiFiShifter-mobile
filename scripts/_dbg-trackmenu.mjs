#!/usr/bin/env node
/** 一次性诊断：轨道头 `contextmenu` 的 React 处理器是否生效（无触摸时应立刻弹菜单）。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid2 = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid2}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const menuNow = () =>
        cdp.call(() => ({
            track: Boolean(document.querySelector('[data-track-ctx-menu]')),
            any: Boolean(document.querySelector('[data-hs-context-menu="1"]')),
            text: (document.querySelector('[data-track-ctx-menu]')?.textContent || '')
                .replace(/\s+/g, ' ')
                .slice(0, 60),
        }));

    console.log('▸ 初始菜单：' + JSON.stringify(await menuNow()));

    // ① 纯 contextmenu（无触摸）
    const fired = await cdp.call(() => {
        const row = document.querySelectorAll('[data-hs-track-row]')[0];
        if (!row) return 'no-row';
        const b = row.getBoundingClientRect();
        row.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: b.left + 24,
                clientY: b.top + 40,
            }),
        );
        return { rows: document.querySelectorAll('[data-hs-track-row]').length, left: Math.round(b.left + 24), top: Math.round(b.top + 40) };
    });
    await sleep(600);
    console.log('▸ ①纯 contextmenu 后：' + JSON.stringify(fired) + ' → ' + JSON.stringify(await menuNow()));

    // ② 触摸长按（不移动）+ 期间 contextmenu + 抬手
    // ⚠️ 先把 ① 打开的菜单关掉，否则"按住期间"的读数全是上一步的残留（第一版就这么误判）。
    await cdp.call(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    });
    await sleep(600);
    console.log('▸ 关闭后：' + JSON.stringify(await menuNow()));
    const res = await cdp.call(
        async () => {
            const row = document.querySelectorAll('[data-hs-track-row]')[0];
            const b = row.getBoundingClientRect();
            const mk = (ty, yy) => {
                const touches =
                    ty === 'touchend'
                        ? []
                        : [new Touch({ identifier: 1, target: row, clientX: b.left + 24, clientY: yy })];
                return new TouchEvent(ty, {
                    bubbles: true,
                    cancelable: true,
                    touches,
                    targetTouches: touches,
                    changedTouches: touches,
                });
            };
            row.dispatchEvent(mk('touchstart', b.top + 40));
            const out = {};
            await new Promise((r) => setTimeout(r, 600));
            out.menuDuringHold = Boolean(document.querySelector('[data-track-ctx-menu]'));
            row.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 24, clientY: b.top + 40 }),
            );
            out.menuJustAfterCtx = Boolean(document.querySelector('[data-track-ctx-menu]'));
            row.dispatchEvent(mk('touchend', b.top + 40));
            out.menuAfterTouchendSync = Boolean(document.querySelector('[data-track-ctx-menu]'));
            await new Promise((r) => setTimeout(r, 400));
            out.menuAfter400ms = Boolean(document.querySelector('[data-track-ctx-menu]'));
            return out;
        },
    );
    console.log('▸ ②触摸序列：' + JSON.stringify(res));
    console.log('▸ ②之后 DOM：' + JSON.stringify(await menuNow()));
    cdp.close();
};

await main();
