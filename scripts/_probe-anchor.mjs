#!/usr/bin/env node
/**
 * 定位「水平捏合锚点漂移 ~3.9px」的根因（docs/memory 里留的待办）。
 *
 * 手势的锚点公式是 `secAtMid = (scrollLeft + mid.x) / pxPerSec`，其中 `mid.x` 是
 * **相对控制器 target 元素左边缘**的像素。如果内核真正滚动的内容元素与 target
 * 有水平偏移 δ（padding / border / 左侧轨道头列），那么公式里的 scrollLeft 与 mid.x
 * 就不同域 —— 缩放时会稳定漂移 δ·(P/P₀−1)。
 *
 * 本探针把三件事一次量出来：
 *   ① 控制器 target 的 rect（`__hsViewport().containerRect`）
 *   ② 容器内真正在滚的元素（scrollWidth > clientWidth）及其 rect / scrollLeft
 *   ③ 两者的 left 差 δ，以及内核 scrollLeft 与滚动元素 scrollLeft 是否一致
 *
 * 用法：node scripts/_probe-anchor.mjs --serial emulator-5554 [--tab timeline|params]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, tab: 'timeline' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--tab') o.tab = argv[++i];
    }
    return o;
}

/** 在页面里量 target 与真实滚动元素（必须自包含）。 */
function inPageMeasure(tab) {
    const vp = tab === 'params'
        ? (window.__hsParamViewport ? window.__hsParamViewport() : null)
        : (window.__hsViewport ? window.__hsViewport() : null);
    if (!vp) return { error: 'no-viewport' };

    // ① target：时间线用 containerRect；参数面板用滚动容器 [data-piano-roll-scroller]
    let targetRect;
    if (tab === 'params') {
        const el = document.querySelector('[data-piano-roll-scroller]');
        if (!el) return { error: 'no-scroller' };
        const r = el.getBoundingClientRect();
        targetRect = { left: +r.left.toFixed(2), top: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    } else {
        const c = vp.containerRect;
        if (!c) return { error: 'no-containerRect' };
        targetRect = { left: +c.left.toFixed(2), top: +c.top.toFixed(2), w: +c.width.toFixed(2), h: +c.height.toFixed(2) };
    }

    // 容器元素（用于向下找滚动后代）
    const host = [...document.querySelectorAll('*')].find((e) => {
        const r = e.getBoundingClientRect();
        return Math.abs(r.left - targetRect.left) < 1.5 && Math.abs(r.top - targetRect.top) < 1.5 && Math.abs(r.width - targetRect.w) < 1.5;
    }) || document.body;

    const scrollers = [];
    const walk = (e) => {
        if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) {
            const r = e.getBoundingClientRect();
            scrollers.push({
                cls: String(e.className || '').slice(0, 40),
                tag: e.tagName,
                left: +r.left.toFixed(2),
                top: +r.top.toFixed(2),
                clientW: e.clientWidth,
                scrollW: e.scrollWidth,
                scrollLeft: +e.scrollLeft.toFixed(2),
                scrollTop: +e.scrollTop.toFixed(2),
                dLeft: +(r.left - targetRect.left).toFixed(2),
                dTop: +(r.top - targetRect.top).toFixed(2),
            });
        }
        for (const c of e.children) walk(c);
    };
    walk(host);

    return {
        targetRect,
        kernel: {
            scrollLeft: vp.scrollLeft != null ? +Number(vp.scrollLeft).toFixed(2) : null,
            scrollTop: vp.scrollTop != null ? +Number(vp.scrollTop).toFixed(2) : null,
            pxPerSec: vp.pxPerSec != null ? +Number(vp.pxPerSec).toFixed(3) : null,
            rowHeight: vp.rowHeight != null ? +Number(vp.rowHeight).toFixed(3) : null,
        },
        scrollers: scrollers.slice(0, 6),
    };
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    const res = await cdp.call(inPageMeasure, o.tab);
    console.log(JSON.stringify(res, null, 1));
    cdp.close();
}

await main();
