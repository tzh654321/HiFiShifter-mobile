#!/usr/bin/env node
/**
 * I-2 / I-3 验收（用户报的两个分屏问题）：
 *   I-2「调整分屏高度时不跟手」        ⇒ 拖动中上块高度应**逐帧跟随手指**；
 *   I-3「参数+文件分屏时无法上下拖动**文件浏览器标题栏**调整分屏」
 *                                    ⇒ 在**文件浏览器标题栏**上按下并上下拖，分屏边界应变化。
 *
 * 关键：手柄优先取 `[data-hs-split-handle="files"]`（用户实际拖的那个），
 * 且必须是**可见**的（rect 有尺寸）——参数拍数栏在分屏里可能还没布局（实测 rect 全 0）。
 *
 * 用法：node scripts\_probe-i2-split-drag.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

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
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
    };
    const menuOpen = async (label) => {
        const b = await cdp.call((lb) => {
            const el = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === lb);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, label);
        if (!b) return false;
        await tap(b.x, b.y);
        return true;
    };
    const menuPick = async (prefix) => {
        const b = await cdp.call((pfx) => {
            const el = [...document.querySelectorAll('[role=menuitem],button,div')].find(
                (x) =>
                    (x.textContent || '').replace(/[✓\s]/g, '').startsWith(pfx) &&
                    x.getBoundingClientRect().height < 60,
            );
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, prefix);
        if (!b) return false;
        await tap(b.x, b.y);
        await sleep(1200);
        return true;
    };
    const split = () =>
        cdp.call(() => {
            const box = document.querySelector('[data-hs-mobile-split="1"]');
            if (!box) return null;
            return {
                children: box.children.length,
                heights: [...box.children].map((c) => Math.round(c.getBoundingClientRect().height)),
                boxH: Math.round(box.getBoundingClientRect().height),
            };
        });

    // 确保分屏：轨道 + 参数 + 文件
    let st = await split();
    console.log('初始：' + JSON.stringify(st));
    if (!st || st.children < 2) {
        await menuOpen('视图');
        await menuPick('参数面板');
    }
    await menuOpen('视图');
    await menuPick('文件浏览器');
    st = await split();
    console.log('轨道+参数+文件：' + JSON.stringify(st));

    // 找**可见**的手柄（文件标题栏优先）
    const handle = await cdp.call(() => {
        const want = ['files', 'notes'];
        const all = [...document.querySelectorAll('[data-hs-split-handle],[data-hs-time-ruler="params"]')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.getAttribute('data-hs-split-handle') || el.getAttribute('data-hs-time-ruler'),
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                w: Math.round(r.width),
                h: Math.round(r.height),
            };
        });
        const visible = all.filter((c) => c.w > 20 && c.h > 4);
        return { all, picked: visible.find((c) => want.includes(c.tag)) ?? visible[0] ?? null };
    });
    console.log('手柄候选：' + JSON.stringify(handle));
    if (!handle.picked) {
        console.log('🔴 没有可见的分屏手柄（标题栏未布局）⇒ 无法验证');
        cdp.close();
        return;
    }
    const h0 = (await split()).heights[0];
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x: handle.picked.x, y: handle.picked.y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(90);
    const samples = [];
    for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ id: 0, x: handle.picked.x, y: handle.picked.y - i * 12, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(70);
        const s = await split();
        samples.push(s ? s.heights[0] : null);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    const hEnd = (await split()).heights[0];
    console.log('拖动中上块高度采样：' + JSON.stringify(samples));
    const nonNull = samples.filter((v) => v !== null);
    const distinct = new Set(nonNull).size;
    check(
        'I-2/I-3 拖手柄时高度**连续跟随**（不被重置、也不是只跳一次）',
        nonNull.length >= 6 && distinct >= 3 && hEnd !== h0,
        `手柄=${handle.picked.tag} 起始 ${h0} → 结束 ${hEnd}；采样 ${JSON.stringify(samples)}（不同值 ${distinct} 个）`,
    );
    cdp.close();
};

await main();
