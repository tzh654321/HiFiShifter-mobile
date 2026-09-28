#!/usr/bin/env node
/**
 * E3 验收：**收起轨道头后，轨道头与轨道仍然对齐**。
 *
 * 病因（用户实测 + 读码）：收起态原来把左上角那行（标题 + 拍数/秒数读数 + 速度映射键）
 * **整行 `display:none`**，而那一行有 `headerHeight` 高度 ⇒ 轨道行整体上移，
 * 与时间线的泳道不再对齐。
 * 用户给的修法：**只隐藏拍数/秒数读数**，保留那一片区域（及其中的速度映射键）。
 *
 * 判据（纯 DOM 几何，不需要触摸以外的能力）：
 *   ① 收起后「时间线拍数栏底边」与「轨道列表首行顶边」的差值，与**收起前一致**（±2px）；
 *   ② 收起后左上角那行**仍然存在且有高度**（不是 display:none）；
 *   ③ 读数文本**确实被隐藏**（innerText 里不再有它）；
 *   ④ 速度映射键仍在（可见）。
 *
 * 用法：node scripts\_probe-e3-collapse-align.mjs [serial]
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

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /** 量：拍数栏底 / 首行顶 / 头行高 / 读数是否隐藏 / 速度映射键是否可见。 */
    const measure = () =>
        cdp.call(() => {
            const vis = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
            };
            const ruler =
                document.querySelector('[data-hs-time-ruler="timeline"]') ??
                document.querySelector('[data-hs-surface="timeline"]');
            const row = document.querySelector('[data-hs-track-row]');
            const headBar = document.querySelector('[data-hs-tracklist-head-bar]');
            const readout = document.querySelector('[data-hs-tracklist-readout]');
            const tempoBtn = [...document.querySelectorAll('button')].find((b) =>
                /速度映射/.test(b.getAttribute('data-tooltip') || b.ariaLabel || ''),
            );
            const rr = ruler ? ruler.getBoundingClientRect() : null;
            const rowR = row ? row.getBoundingClientRect() : null;
            const hbR = headBar ? headBar.getBoundingClientRect() : null;
            return {
                collapsed: document.body.getAttribute('data-hs-header-collapsed'),
                rulerBottom: rr ? Math.round(rr.bottom) : null,
                firstRowTop: rowR ? Math.round(rowR.top) : null,
                delta: rr && rowR ? Math.round(rowR.top - rr.bottom) : null,
                headBar: hbR ? { top: Math.round(hbR.top), h: Math.round(hbR.height), visible: vis(headBar) } : null,
                readoutVisible: vis(readout),
                tempoBtnVisible: vis(tempoBtn),
            };
        });

    // 收起前
    const before = await measure();
    console.log('▸ 收起前：' + JSON.stringify(before));

    /* 进入收起态。
       ⚠️ 这里**直接置位** `data-hs-header-collapsed`，而不是模拟左划手势：
         · 左划监听挂在轨道列容器上、要求 |dx|≥48 且 |dy|≤24 的**原生 touch**；
           CDP 合成触摸在模拟器上不稳（试了两轮都是 collapsed=null，与手势本身无关）；
         · 而 E3 要验的是**收起态的样式与钩子**（只隐藏读数、保留区域与速度映射键），
           手势入口此前已在真机验过 ⇒ 直接置位即可精确隔离本条的改动。 */
    const applied = await cdp.call(() => {
        document.body.setAttribute('data-hs-header-collapsed', '1');
        return document.body.getAttribute('data-hs-header-collapsed');
    });
    console.log('▸ 已置位收起态：' + applied);
    await sleep(700);
    const after = await measure();
    console.log('▸ 收起后：' + JSON.stringify(after));

    check(
        'E3-a 收起后仍然**对齐**（拍数栏底 → 首行顶 的差值与收起前一致 ±2px）',
        before.delta !== null && after.delta !== null && Math.abs(after.delta - before.delta) <= 2,
        `差值 ${before.delta} → ${after.delta}（改前会整行消失 ⇒ 差值会差一个 headerHeight）`,
    );
    check(
        'E3-b 左上角那行**仍在且有高度**（不是 display:none）',
        after.headBar !== null && after.headBar.visible === true && after.headBar.h > 0,
        JSON.stringify(after.headBar),
    );
    check(
        'E3-c 拍数/秒数读数**被隐藏**',
        after.readoutVisible === false,
        `readoutVisible=${after.readoutVisible}`,
    );
    check(
        'E3-d 速度映射键**仍然可见**（收起态保留）',
        after.tempoBtnVisible === true,
        `tempoBtnVisible=${after.tempoBtnVisible}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
