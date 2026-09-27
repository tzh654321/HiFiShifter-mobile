#!/usr/bin/env node
/**
 * D1 验收：手机上**不得出现键盘快捷键提示**。
 *
 * 判据：打开带快捷键提示的菜单（长按轨道菜单 / 音频块右键菜单），
 * 断言这些提示元素的**计算 display = none**（即 `.hs-menu-shortcut` 生效），
 * 同时**菜单项本身仍在**（不能把整个菜单项藏掉）。
 *
 * 用法：node scripts\_probe-shortcut-hints.mjs [serial]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';
const WAV = 'D:\\Temp\\hs-tone.wav';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /* ① 长按轨道 → 轨道菜单（用真实 contextmenu：CDP 触摸复现不出 WebView 的长按识别） */
    const trackMenu = await cdp.call(async () => {
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
        await wait(500);
        const menu = document.querySelector('[data-track-ctx-menu]');
        if (!menu) return { error: 'no-menu' };
        const hints = [...menu.querySelectorAll('.hs-menu-shortcut')].map((el) => ({
            text: (el.textContent || '').trim(),
            display: getComputedStyle(el).display,
        }));
        const items = [...menu.querySelectorAll('button')].map((el) =>
            (el.textContent || '').trim().slice(0, 10),
        );
        return { hints, items, visibleText: (menu.innerText || '').replace(/\s+/g, ' ').slice(0, 80) };
    });
    console.log('▸ 轨道菜单：' + JSON.stringify(trackMenu));
    check(
        'D1-a 长按轨道的菜单里**没有**快捷键提示（Ctrl+T / Ctrl+D / Ctrl+Delete）',
        !trackMenu.error &&
            trackMenu.hints.length > 0 &&
            trackMenu.hints.every((h) => h.display === 'none') &&
            !/Ctrl\+/.test(trackMenu.visibleText || ""),
        `提示元素=${JSON.stringify(trackMenu.hints)}；菜单项=${JSON.stringify(trackMenu.items)}`,
    );
    await cdp.call(() => {
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await sleep(500);

    /* ② 音频块右键菜单：同样不该有快捷键提示 */
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(1200);
    await cdp.call((b) => window.__hsImportAudioBase64('d1.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1600);

    const clipMenu = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const vp = window.__hsViewport();
        const state = await window.__TAURI_INTERNALS__.invoke('get_timeline_state');
        const raw = (state.clips || [])[0];
        if (!raw) return { error: 'no-clip' };
        const c = vp.containerRect;
        const rowEl = document.querySelector(`[data-hs-track-row="${raw.track_id}"]`);
        const rr = rowEl ? rowEl.getBoundingClientRect() : null;
        const left = c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft;
        const x = Math.round(left + 30);
        const y = Math.round((rr ? rr.top : c.top) + (rr ? rr.height : vp.rowHeight) * 0.6);
        const target = document.elementFromPoint(x, y) ?? document.body;
        target.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
        );
        await wait(600);
        const menu = document.querySelector('[data-hs-context-menu="1"]');
        if (!menu) return { error: 'no-menu', x, y };
        const hints = [...menu.querySelectorAll('.hs-menu-shortcut')].map((el) => ({
            text: (el.textContent || '').trim(),
            display: getComputedStyle(el).display,
        }));
        return { hints, visibleText: (menu.innerText || '').replace(/\s+/g, ' ').slice(0, 100) };
    });
    console.log('▸ 音频块菜单：' + JSON.stringify(clipMenu));
    check(
        'D1-b 音频块菜单里**没有**快捷键提示',
        !clipMenu.error && !/Ctrl\+/.test(clipMenu.visibleText || ''),
        `${JSON.stringify(clipMenu)}（提示元素必须 display:none；菜单项仍在）`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
