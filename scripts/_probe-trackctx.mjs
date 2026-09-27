#!/usr/bin/env node
/**
 * 轨道头「长按菜单」验收（用户口径：重命名 / 调算法 收进长按菜单）。
 *
 * 为什么不能靠 `touch-drive tap --hold`：长按由**浏览器原生手势识别**合成为
 * `contextmenu`，而 CDP 的 `Input.dispatchTouchEvent` 是直接投递触摸事件、
 * 不经过那层识别 ⇒ 不会产生 contextmenu。
 * 这里改为在页面里**派发真实的 `contextmenu` MouseEvent**（React 用根节点委托，
 * 派发到轨道行即可命中 `onContextMenu`），再读菜单内容。
 *
 * 用法：node scripts/_probe-trackctx.mjs --serial emulator-5554
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, compose: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--compose') o.compose = true;
    }
    return o;
}

/** 在页面里选中第一条轨道行并派发 contextmenu（自包含）。 */
function inPageOpenCtxMenu() {
    const panel = document.querySelector('[data-track-list-panel]');
    if (!panel) return { error: 'no-track-list-panel（不在轨道页签？）' };
    // 轨道行 = 面板里带 onContextMenu 的那层 div：用「含 data-track-id 后代」定位
    const rows = [...panel.querySelectorAll('div')].filter(
        (d) => d.className && /border-b/.test(d.className) && d.querySelector('[data-track-id]'),
    );
    const row = rows[0] ?? panel.firstElementChild;
    if (!row) return { error: 'no-row' };
    const r = row.getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 20,
        clientY: r.top + 20,
    });
    row.dispatchEvent(ev);
    return { ok: true, rowRect: { x: Math.round(r.left), y: Math.round(r.top), h: Math.round(r.height) } };
}

/** 读长按菜单内容（自包含）。 */
function inPageReadCtxMenu() {
    const m = document.querySelector('[data-track-ctx-menu]');
    if (!m) return { error: 'no-ctx-menu' };
    const r = m.getBoundingClientRect();
    const items = [...m.querySelectorAll('button')].map((b) => {
        const q = b.getBoundingClientRect();
        return {
            t: (b.textContent || '').trim().slice(0, 18),
            x: Math.round(q.left + q.width / 2),
            y: Math.round(q.top + q.height / 2),
            w: Math.round(q.width),
        };
    });
    return {
        panel: { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
        inView: r.top >= 0 && r.bottom <= window.innerHeight,
        items,
    };
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');

    // `--compose`：先把根轨的 Compose（C）打开，算法项才有意义。
    if (o.compose) {
        const c = await cdp.call(() => {
            const btn = [...document.querySelectorAll("[data-track-list-panel] button")].find(
                (b) => (b.textContent || "").trim() === "C",
            );
            if (!btn) return { error: "no-C-button" };
            btn.click();
            return { ok: true };
        });
        console.log(`▸ 开启 Compose：${JSON.stringify(c)}`);
        await sleep(1200);
    }

    const opened = await cdp.call(inPageOpenCtxMenu);
    if (opened.error) {
        console.log('❌', opened.error);
        cdp.close();
        process.exit(2);
    }
    console.log(`▸ 已向轨道行 ${JSON.stringify(opened.rowRect)} 派发 contextmenu`);
    await sleep(400);
    const menu = await cdp.call(inPageReadCtxMenu);
    console.log(JSON.stringify(menu, null, 1));

    // 顺手验证「触屏下双击轨道名不再进入重命名」：读输入框是否存在
    const dbl = await cdp.call(() => {
        const nameEl = [...document.querySelectorAll('[data-track-list-panel] *')].find(
            (e) => e.children.length === 0 && /^Main|^Track|^轨道/.test((e.textContent || '').trim()) && e.className && /cursor-text/.test(String(e.className)),
        );
        if (!nameEl) return { found: false };
        nameEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        return { found: true, text: (nameEl.textContent || '').trim() };
    });
    await sleep(300);
    const hasInput = await cdp.call(
        () => !!document.querySelector('[data-track-list-panel] input'),
    );
    console.log(
        `▸ 双击轨道名（触屏守卫）：${dbl.found ? `派发 dblclick 到「${dbl.text}」` : '未找到轨道名元素'} ⇒ 出现输入框 = ${hasInput}  ${
            hasInput ? '⚠️ 守卫未生效' : '✅ 未进入重命名'
        }`,
    );
    cdp.close();
}

await main();
