#!/usr/bin/env node
/**
 * E10-② 复现：**用拖动「上工具栏」的方式反复切换「参数全屏 ⇄ 参数+轨道分屏」**，看参数界面会不会白屏。
 *
 * 用户口径（2026-09-30）：「使用拖动上工具栏的方式反复切换 参数界面全屏 与 参数+轨道分屏，
 * **10 次之内通常就能触发**参数界面的白屏」。
 *
 * 与既有 `_probe-i4-white-screen.mjs` 的区别：那个是**切页签**触发；这里按用户口径走
 * **拖手柄**（每帧改 flexGrow、跨过"一侧自动关闭"的边界），是另一条代码路径。
 *
 * 每半轮记一次健康度：页面能否求值 / 参数面板在不在 / 参数面板高度 / 画布数 / 视图口钩子 /
 * `body.innerText` 长度 / 是否出现"内核不可用"页；同时落 `logcat`（chromium / 崩溃 / GL）。
 *
 * 用法：node scripts/_dbg-e10b-whitescreen.mjs [serial] [rounds]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内：健康度快照。 */
function inPageHealth() {
    const pane = document.querySelector('[data-hs-pane="params"]');
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    const canvas = document.querySelectorAll('canvas');
    return {
        pane: !!pane,
        paneH: paneRect ? Math.round(paneRect.height) : null,
        paneOpacity: pane ? +(+getComputedStyle(pane).opacity).toFixed(2) : null,
        canvases: canvas.length,
        /* E10-② 的关键健康指标：**每个 WebGL context 是否已被强制丢失**。
           （DOM 在不在、opacity 是不是 1 都测不出白屏 —— 白屏是"canvas 在、画不出东西"。） */
        gl: [...canvas].reduce(
            (acc, c) => {
                const ctx = c.getContext('webgl2');
                if (!ctx) acc.none++;
                else if (ctx.isContextLost()) acc.lost++;
                else acc.ok++;
                return acc;
            },
            { ok: 0, lost: 0, none: 0 },
        ),
        paramVp: typeof window.__hsParamViewport === 'function',
        viewport: typeof window.__hsViewport === 'function',
        bodyLen: (document.body.innerText || '').length,
        kernelUnavailable: /内核不可用|无法渲染|渲染失败/.test(document.body.innerText || ''),
        handle: !!document.querySelector('[data-hs-split-handle]'),
        splitKids: (document.querySelector('[data-hs-mobile-split]') || { children: [] }).children.length,
    };
}

/** 页面内：手柄位置与容器几何。 */
function inPageHandle() {
    const h = document.querySelector('[data-hs-split-handle]');
    const cont = document.querySelector('[data-hs-mobile-split]');
    if (!h || !cont) return { error: 'no-handle-or-container' };
    const hr = h.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    return {
        handle: { x: Math.round(hr.left + hr.width / 2), y: Math.round(hr.top + hr.height / 2) },
        container: { top: Math.round(cr.top), h: Math.round(cr.height), left: Math.round(cr.left), w: Math.round(cr.width) },
    };
}

async function main() {
    const serial = process.argv[2] || 'emulator-5554';
    const rounds = Number(process.argv[3] || 15);
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    /* logcat 清空，跑完再 dump（含 chromium / 崩溃 / GL） */
    try {
        execSync(`adb -s ${serial} logcat -c`);
    } catch {
        /* ignore */
    }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    /** 拖手柄到容器内的目标比例（0=顶, 1=底）。 */
    async function dragHandleTo(ratio) {
        const g = await cdp.call(inPageHandle);
        if (g.error) return g;
        const y0 = g.handle.y;
        const y1 = Math.round(g.container.top + g.container.h * ratio);
        const x = g.handle.x;
        await touch('touchStart', [{ x, y: y0 }]);
        await sleep(90);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [{ x, y: Math.round(y0 + ((y1 - y0) * i) / 6) }]);
            await sleep(70);
        }
        await touch('touchEnd', []);
        await sleep(650);
        return { from: y0, to: y1 };
    }
    /** 用桥接事件把两个面板都恢复出来（保证下一轮手柄存在）。 */
    async function ensureSplit() {
        await cdp.call(() => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
            return true;
        });
        await sleep(900);
    }

    await ensureSplit();
    let h = await cdp.call(inPageHealth);
    console.log('▸ 起始：' + JSON.stringify(h));
    if (!h.pane || !h.handle) throw new Error('前置不满足：需要"参数 + 轨道"分屏且手柄在');

    let broke = 0;
    let maxLost = 0;
    for (let i = 1; i <= rounds; i++) {
        await dragHandleTo(0.92); // ⇒ 轨道被挤掉 = 参数全屏
        let a = null;
        try {
            a = await cdp.call(inPageHealth);
        } catch (e) {
            a = { error: String(e).slice(0, 80) };
        }
        await ensureSplit(); // 回到分屏，好让下一次还能拖
        let b = null;
        try {
            b = await cdp.call(inPageHealth);
        } catch (e) {
            b = { error: String(e).slice(0, 80) };
        }
        const bad = a.error || b.error || (a.pane && a.paneOpacity === 0) || a.kernelUnavailable;
        if (bad) broke++;
        /* ⚠️ 不因为"context 被丢失"就提前退出：要看到**丢失之后能不能自愈**
           （这正是本次修法的关键 —— 强制丢失不可避免，但不该是永久白屏）。 */
        console.log(
            `  第 ${i} 轮：全屏[canvas=${a.canvases} pane=${a.pane} gl=${JSON.stringify(a.gl)}]` +
                ` 分屏[canvas=${b.canvases} pane=${b.pane} gl=${JSON.stringify(b.gl)}]` +
                `  丢失合计=${(a.gl ? a.gl.lost : 0) + (b.gl ? b.gl.lost : 0)}${bad ? '  🔴页面异常' : ''}`,
        );
        maxLost = Math.max(maxLost, (a.gl ? a.gl.lost : 0) + (b.gl ? b.gl.lost : 0));
        if (a.error || b.error) break;
    }

    console.log(`\n轮次：${rounds}（每轮 = 拖到参数全屏 → 桥接恢复分屏）  页面异常轮=${broke}  单轮最多丢失 context=${maxLost}`);
    const log = execSync(
        `adb -s ${serial} logcat -d -t 1200`,
        { maxBuffer: 32 * 1024 * 1024 },
    )
        .toString()
        .split('\n')
        .filter((l) => /chromium|RenderProcessGone|SIGSEGV|WebGL|Context Lost|hifishifter.*(died|crash)|libGL|gralloc/i.test(l));
    console.log(`\nlogcat 命中 ${log.length} 行：`);
    for (const l of log.slice(-30)) console.log('  ' + l.slice(0, 200));
    cdp.close();
}

await main();
