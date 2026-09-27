#!/usr/bin/env node
/**
 * D3 前置验收：两根 `TimeRuler` 是否带**可区分**的 DOM 钩子。
 *
 * 需求链：D3 = 分屏态 + 打开「同步参数编辑器水平位置与缩放」时，
 * 只保留**一个**顶部拍数栏与一个底部滑动条。可两根标尺在 DOM 上完全同形，
 * CSS 挑不出该隐藏哪一个 ⇒ 先给它们加 `data-hs-time-ruler="timeline" | "params"`。
 *
 * 本探针只验**钩子存在且可区分**，不验隐藏行为（那属于 D3 本体）。
 *
 * ── 怎么把两个面板同时弄出来（本批踩到的坑，都写在代码里了）──────────────
 * · **手机端底部 tab 已被 E 组规格移除** ⇒ 没有「参数」页签可点，别再找 `nav`/`[role=tab]`。
 * · 面板显隐是 Redux `session.mobilePanels`，入口在**顶栏「视图」菜单**里（「参数面板」项）。
 * · 菜单开关状态很脆：上一次调用把菜单留着开着，这次 `.click()` 就变成**关**。
 *   所以必须先「若已开就直接找项，否则再用完整合成事件序列开菜单」。
 * · 只在**平板视口**才能两个面板同屏（`wm size 1600x2560` + `wm density 320` ⇒ CSS 800×1176）。
 *   切档后 `wm density` 会杀掉应用 ⇒ 必须 force-stop + 重启 + **重建 CDP forward**。
 *
 * 用法：node scripts\_probe-time-ruler-hooks.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';
const VALID = ['timeline', 'params'];

/** 浏览器里跑的：把「参数面板」打开（菜单已开就直接点，否则先开菜单）。 */
const OPEN_PARAMS_PANEL = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const menus = () => [
        ...document.querySelectorAll(
            '[role=menu],[data-radix-popper-content-wrapper],.rt-DropdownMenuContent',
        ),
    ];
    const findItem = () => {
        for (const p of menus()) {
            const it = [...p.querySelectorAll('[role=menuitem],[role=menuitemcheckbox]')].find(
                (e) => (e.innerText || '').trim().replace(/\s+/g, ' ') === '参数面板',
            );
            if (it) return it;
        }
        return null;
    };
    let item = findItem();
    let opened = null;
    if (!item) {
        const trigger = [...document.querySelectorAll('button')].find(
            (x) => (x.innerText || '').trim() === '视图',
        );
        if (!trigger) return { error: 'no-view-menu' };
        const r = trigger.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // 只 `.click()` 不稳；补一整串合成事件
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            trigger.dispatchEvent(
                new MouseEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }),
            );
        }
        // 菜单有动画/渲染延迟，而且上一次调用可能把它留着开着 ⇒ 重试几轮再判定
        for (let i = 0; i < 4 && !item; i++) {
            await wait(700);
            item = findItem();
        }
        opened = menus().length;
    }
    if (!item) return { error: 'no-params-item', menusOpened: opened };
    item.click();
    await wait(2000);
    return { ok: true };
};

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward --remove-all`);
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    await sleep(800);
    const before = await cdp.call(() => {
        const read = () =>
            [...document.querySelectorAll('[data-hs-time-ruler]')].map((e) => {
                const r = e.getBoundingClientRect();
                return {
                    v: e.getAttribute('data-hs-time-ruler'),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                };
            });
        return { vw: innerWidth, vh: innerHeight, rulers: read() };
    });
    console.log(`▸ 视口 ${before.vw}×${before.vh}；标尺 ${JSON.stringify(before.rulers)}`);

    const opened = await cdp.call(OPEN_PARAMS_PANEL);
    console.log('▸ 打开「参数面板」：' + JSON.stringify(opened));

    const after = await cdp.call(() => {
        const read = () =>
            [...document.querySelectorAll('[data-hs-time-ruler]')].map((e) => {
                const r = e.getBoundingClientRect();
                return {
                    v: e.getAttribute('data-hs-time-ruler'),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                };
            });
        return { vw: innerWidth, rulers: read() };
    });
    console.log(`▸ 打开后视口 ${after.vw}；标尺 ${JSON.stringify(after.rulers)}`);

    const values = (after.rulers ?? []).map((r) => r.v);
    const bad = values.filter((v) => !VALID.includes(v));
    const seen = new Set([...values, ...(before.rulers ?? []).map((r) => r.v)]);

    check(
        'D3p-a 标尺根节点都带钩子，且取值只在 timeline / params 内',
        values.length > 0 && bad.length === 0,
        `取值=${JSON.stringify(values)}；非法值=${JSON.stringify(bad)}`,
    );
    check(
        'D3p-b 两个取值都出现过（两个调用点都接上了）',
        VALID.every((v) => seen.has(v)),
        `seen=${JSON.stringify([...seen])}（若只有 timeline ⇒ 当前非平板视口 / 参数面板没打开）`,
    );
    check(
        'D3p-c 同屏多个标尺取值互不相同（CSS 可区分的前提）',
        values.length === new Set(values).size,
        `同屏=${JSON.stringify(values)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
