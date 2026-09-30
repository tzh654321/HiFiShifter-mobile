#!/usr/bin/env node
/**
 * E22 验收：统一动效层是否**真的在跑**（菜单展开 / 面板弹出），以及"关掉动画"开关是否有效。
 *
 * 用户口径：「补充动画：弹出分屏动画、移动轨道动画、菜单展开动画、各种拖动操作的平滑化/惯性化 等」，
 * 并明确「**统一做一套**」。
 *
 * 【判据来源】不看截图、不靠肉眼：
 *   ① `animationstart` 事件（带 `animationName`）—— 动画**确实启动**的硬证据；
 *   ② rAF 逐帧采样 `getComputedStyle(el).opacity / transform` —— 观察**是否真的从 0 渐变到 1**
 *      （只看 `animation-name` 会被"规则写了但没跑"骗过去）；
 *   ③ 对照：`body[data-hs-no-anim]` ⇒ 必须**没有** `animationstart`、opacity 恒为 1。
 *
 * ⚠️ 采样必须在**页面内**做：CDP 输入与 `Runtime.evaluate` 是两个通道，等一次往返再读就已经是
 * 150ms 动画的尾巴了（E18 轮踩过，见 docs/17 §触摸类探针的读数纪律）。
 *
 * ⚠️ 手机档的 Radix 菜单**用 `.click()` 打不开**（本探针第一版就栽在这：采样 0 帧 = 菜单根本没出现）。
 * 这里先试**真触摸**，不行再退回合成的鼠标事件序列，并把"哪种方式打开了"打进输出。
 *
 * 用法：node scripts/_probe-e22-anim.mjs --serial emulator-5554
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
    }
    return o;
}

/** 页面内：装动画记录器（animationstart + rAF opacity/transform 采样）。 */
function inPageSetup(payload) {
    const w = window;
    if (payload.noAnim) document.body.dataset.hsNoAnim = '1';
    else delete document.body.dataset.hsNoAnim;
    if (w.__hsAnimHooked !== true) {
        w.__hsAnimHooked = true;
        document.addEventListener(
            'animationstart',
            (e) => {
                (w.__hsAnimEvents || []).push({
                    name: e.animationName,
                    cls: String(e.target.className || '').slice(0, 46),
                });
            },
            true,
        );
    }
    w.__hsAnimEvents = [];
    w.__hsAnimSamples = [];
    const t0 = performance.now();
    /**
     * ⚠️ 采样**不能只靠 rAF**：挂载"参数面板"这类重活会让 rAF 饿死
     * （实测真机/模拟器：190ms 的动画只采到 1 帧，而 `animationstart` 明明已经触发）。
     * 改用 `setInterval(16ms)` —— 读 `getComputedStyle` 不依赖帧回调。
     */
    const timer = setInterval(() => {
        const els = [...document.querySelectorAll(payload.watch)];
        const el = els[els.length - 1];
        if (el) {
            const cs = getComputedStyle(el);
            w.__hsAnimSamples.push({
                t: Math.round(performance.now() - t0),
                op: +(+cs.opacity).toFixed(3),
                tf: cs.transform === 'none' ? 'none' : 'matrix',
            });
        }
        if (performance.now() - t0 >= payload.dur) clearInterval(timer);
    }, 16);
    return true;
}

function inPageRead() {
    return {
        events: window.__hsAnimEvents || [],
        samples: window.__hsAnimSamples || [],
        menuOpen: !!document.querySelector('[role="menu"]'),
    };
}

function inPageButtonBox(label) {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === label);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

/** 页面内：合成鼠标事件序列打开菜单（有些档位只认这套）。 */
function inPageSynthClick(label) {
    const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === label);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    }
    return true;
}

function inPageCloseMenu() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 }));
    return true;
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const touchTap = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 8, radiusY: 8, force: 1 }],
        });
        await sleep(70);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };
    const ramp = (samples) => {
        const osc = samples.map((s) => s.op);
        return {
            n: osc.length,
            lower: osc.filter((v) => v < 0.99).length,
            first: osc.length ? osc[0] : null,
            last: osc.length ? osc[osc.length - 1] : null,
        };
    };

    console.log('▸ 视口：' + JSON.stringify(await cdp.call(() => ({ vw: innerWidth, vh: innerHeight }))));

    /* ── E22-① 菜单展开动画 ─────────────────────────────────────────────── */
    {
        await cdp.call(() => {
            delete document.body.dataset.hsNoAnim;
            return true;
        });
        let mode = 'touch';
        let out = null;
        for (const m of ['touch', 'synth']) {
            await cdp.call(inPageCloseMenu);
            await sleep(400);
            await cdp.call(inPageSetup, { noAnim: false, watch: '[role="menu"]', dur: 560 });
            const box = await cdp.call(inPageButtonBox, '\u89c6\u56fe');
            if (!box) throw new Error('找不到「视图」按钮');
            if (m === 'touch') await touchTap(box.x, box.y);
            else await cdp.call(inPageSynthClick, '\u89c6\u56fe');
            await sleep(800);
            out = await cdp.call(inPageRead);
            if (out.menuOpen || out.samples.length > 0) {
                mode = m;
                break;
            }
            console.log(`  ⚠️ ${m} 方式没打开菜单，换一种再试`);
        }
        const g = ramp(out.samples);
        const started = out.events.filter((e) => e.name === 'hs-menu-in');
        const withTransform = out.samples.some((s) => s.tf === 'matrix');
        check(
            'E22-① 菜单展开：animationstart 有 hs-menu-in + opacity 由 0 渐到 1',
            started.length >= 1 && g.lower >= 2 && g.last !== null && g.last > 0.97,
            `打开方式=${mode}；animationstart=${JSON.stringify(out.events.slice(0, 3))}；` +
                `采样 ${g.n} 帧、其中 <1 的 ${g.lower} 帧（首 ${g.first} → 末 ${g.last}）；出现 transform=${withTransform}`,
        );
        await cdp.call(inPageCloseMenu);
        await sleep(300);
    }

    /* ── E22-② 面板弹出动画（用**文件面板**，理由见下）────────────────────────
     * ⚠️ 不用参数面板：它的挂载会把主线程**独占到 ~0.9s**（模拟器软件 GL + 钢琴窗内核），
     * 期间 `setInterval` 都排不上队 ⇒ 1.9s 才 1 帧、看不到渐变（而 `animationstart`
     * 明明已经触发）。这是**测量环境的限制**，不是动画没跑；换成轻量的文件面板即可量化。 */
    {
        await cdp.call(() => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
            return true;
        });
        await sleep(1000);
        /* ⚠️ 必须**真的卸载**参数面板再装回来：React 复用同型节点时 CSS 动画不会重启，
         * 而 `hs-mobile-close-panel` 走的是 `toggle`（本来就关着时它会**打开**）——
         * 所以这里改成"读到还在就一直点，直到看不见面板为止"。 */
        for (let i = 0; i < 4; i++) {
            const alive = await cdp.call(() => !!document.querySelector('[data-hs-pane="files"]'));
            if (!alive) break;
            await cdp.call(() => {
                window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: 'files' } }));
                return true;
            });
            await sleep(800);
        }
        const unmounted = !(await cdp.call(() => !!document.querySelector('[data-hs-pane="files"]')));
        await cdp.call(inPageSetup, { noAnim: false, watch: '[data-hs-pane="files"]', dur: 700 });
        await cdp.call(() => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'files' } }));
            return true;
        });
        await sleep(900);
        const out = await cdp.call(inPageRead);
        const g = ramp(out.samples);
        const started = out.events.filter((e) => e.name === 'hs-fade-in');
        check(
            'E22-② 面板弹出（文件面板）：新挂载的面板块有 hs-fade-in + opacity 渐入',
            /* 判据：`animationstart` 命中 **且** 首帧接近不可见、末帧可见。
             * （不像 ① 那样要求"多帧 <1"：挂载面板会把主线程占住一两百毫秒，
             * 采样必然稀疏 —— 这是测量环境的限制，不是动画没跑。） */
            unmounted &&
                started.length >= 1 &&
                g.first !== null &&
                g.first < 0.5 &&
                g.last !== null &&
                g.last > 0.97,
            `前置已卸载=${unmounted}；animationstart=${JSON.stringify(out.events.slice(0, 3))}；` +
                `采样 ${g.n} 帧、其中 <1 的 ${g.lower} 帧（首 ${g.first} → 末 ${g.last}）`,
        );
    }

    /* ── E22-③ 对照：body[data-hs-no-anim] ⇒ 不跑动画 ─────────────────────── */
    {
        await cdp.call(inPageCloseMenu);
        await sleep(400);
        await cdp.call(inPageSetup, { noAnim: true, watch: '[role="menu"]', dur: 560 });
        const box = await cdp.call(inPageButtonBox, '\u89c6\u56fe');
        await touchTap(box.x, box.y);
        await sleep(800);
        let out = await cdp.call(inPageRead);
        if (!out.menuOpen && out.samples.length === 0) {
            await cdp.call(inPageCloseMenu);
            await sleep(300);
            await cdp.call(inPageSetup, { noAnim: true, watch: '[role="menu"]', dur: 560 });
            await cdp.call(inPageSynthClick, '\u89c6\u56fe');
            await sleep(800);
            out = await cdp.call(inPageRead);
        }
        const g = ramp(out.samples);
        const started = out.events.filter((e) => e.name === 'hs-menu-in');
        check(
            'E22-③ 对照：置 body[data-hs-no-anim] 后**没有** animationstart、opacity 恒 1',
            g.n > 0 && started.length === 0 && g.lower === 0,
            `animationstart=${JSON.stringify(out.events.slice(0, 3))}；采样 ${g.n} 帧、其中 <1 的 ${g.lower} 帧（首 ${g.first} → 末 ${g.last}）`,
        );
        await cdp.call(inPageCloseMenu);
        await cdp.call(() => {
            delete document.body.dataset.hsNoAnim;
            return true;
        });
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== E22 动效探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
