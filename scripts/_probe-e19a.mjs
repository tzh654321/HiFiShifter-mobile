#!/usr/bin/env node
/**
 * E19a 针对性验证：手机端「还原」工具（底栏工具菜单里）切换 + 在参数画布上拖动。
 *
 * 用户口径：「还原画笔**无法拖动使用**，只能一次点一个点」。
 * 代码上「还原」= `toolMode === "restore"` ⇒ 走 `mode: "restore"` 的 stroke 路径，
 * 与电脑右键拖动同一条服务端路径（`restoreParamFrames`）。
 *
 * 本脚本只做**能观测的事**：① 能否切到「还原」；② 拖动过程中参数是否被连续改写
 * （用后端 `get_param_frames` 类命令取值前后对比）。
 *
 * 用法：node scripts\_probe-e19a.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const check = (n, ok, d) => console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    const tap = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(70);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
    };
    const btnAt = (label) =>
        cdp.call((lb) => {
            const el = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === lb || (x.getAttribute('data-tooltip') || '') === lb,
            );
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, label);

    // 切到参数面板
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });

    // 找「还原」项：它可能在底栏工具菜单里 ⇒ 先把可见的「还原」列出来
    let restore = await btnAt('还原');
    console.log('直接可见的「还原」：' + JSON.stringify(restore));
    if (!restore) {
        // 打开底栏的 ^ 浮层，再看
        const fold = await cdp.call(() => {
            const t = [...document.querySelectorAll('button')].find(
                (b) => (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '') === '更多开关',
            );
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        console.log('^ 浮层按钮：' + JSON.stringify(fold));
        if (fold) {
            await tap(fold.x, fold.y);
            await sleep(1000);
        }
        restore = await btnAt('还原');
        console.log('打开 ^ 后「还原」：' + JSON.stringify(restore));
    }
    check('E19a-0 页面上能找到「还原」工具入口', Boolean(restore), JSON.stringify(restore));
    if (!restore) {
        cdp.close();
        return;
    }
    await tap(restore.x, restore.y);
    await sleep(900);
    const picked = await cdp.call(() => {
        // 取当前绘制工具：按钮上有选中样式或 aria-pressed
        const cands = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").includes("还原"));
        return cands.map((b) => ({ text: (b.textContent || "").trim().slice(0, 8), pressed: b.getAttribute("aria-pressed"), cls: String(b.className || "").slice(0, 40) }));
    });
    console.log('选中状态：' + JSON.stringify(picked));

    // 参数画布上拖动
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 80).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const x0 = canvas.x + 30;
        const y0 = canvas.y + Math.round(canvas.h * 0.5);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: x0, y: y0, radiusX: 6, radiusY: 6, force: 1 }] });
        await sleep(90);
        const moves = [];
        for (let i = 1; i <= 14; i++) {
            const x = x0 + i * 9;
            const y = y0 - (i % 3) * 7;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }] });
            moves.push([x, y]);
            await sleep(55);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(1200);
        console.log(`已发送 ${moves.length} 次 touchmove`);
    }
    console.log('（判读：若后端参数在拖动区间被改写 ⇒ 拖动生效；否则复现"只能点一个点"）');
    cdp.close();
};

await main();
