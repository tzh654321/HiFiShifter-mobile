#!/usr/bin/env node
/**
 * E10 精确复现：**分屏 → 参数界面全屏**（用正确的切换入口）。
 *
 * 关键修正（上一轮探针的两处错误）：
 *   · 面板切换入口不是「视图」菜单（那不是 role=menuitem）⇒ 用 App 的事件桥
 *     `hs-toggle-mobile-panel`（App.tsx 里 `detail.key` ⇒ dispatch(toggleMobilePanel(key))）；
 *   · 参数面板画布选择器是 `data-piano-roll-canvas`。
 *
 * 判据/取证：
 *   · 参数面板「占屏率」= 面板可视面积 / 视口面积（不满屏 = 明显 < 100%）；
 *   · 是否出现「内核不可用」页（i18n 标题：`时间轴无法渲染（WebGL2 不可用）`）；
 *   · 画布数量与尺寸（含 0 尺寸 = 布局塌陷的直接证据）；
 *   · 进程存活 + logcat 里剪贴板相关行。
 *
 * 用法：node scripts\_probe-e10-fullscreen2.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid0 = adb('shell pidof com.arounder.hifishifter').trim();
    adb('logcat -c');
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid0);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const probe = async (label) => {
        try {
            const d = await cdp.call(() => {
                const rect = (s) => {
                    const el = document.querySelector(s);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
                };
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const txt = document.body.innerText || '';
                const canvases = [...document.querySelectorAll('canvas')].map((c) => {
                    const r = c.getBoundingClientRect();
                    return { cssW: Math.round(r.width), cssH: Math.round(r.height), w: c.width, h: c.height };
                });
                const pr = rect('[data-piano-roll-canvas]');
                // 参数面板的容器：canvas 的最近「有尺寸的祖先」占比更有意义
                const wrap = document.querySelector('[data-piano-roll-scroller]') ?? document.querySelector('[data-piano-roll-canvas]');
                const wr = wrap ? wrap.getBoundingClientRect() : null;
                return {
                    vw,
                    vh,
                    canvasRect: pr,
                    scrollerRect: wr
                        ? { w: Math.round(wr.width), h: Math.round(wr.height), y: Math.round(wr.top) }
                        : null,
                    canvasCount: canvases.length,
                    zeroSizedCanvases: canvases.filter((c) => c.cssW === 0 || c.cssH === 0).length,
                    kernelUnavailable: /WebGL2 不可用|时间轴无法渲染/.test(txt),
                    clipBtn: /复制诊断信息/.test(txt),
                };
            });
            console.log(`▸ [${label}] ${JSON.stringify(d)}`);
            return d;
        } catch (e) {
            console.log(`▸ [${label}] ❌ 页面无响应：${String(e).slice(0, 120)}`);
            return null;
        }
    };

    const togglePanel = async (key) => {
        await cdp.call(async (k) => {
            window.dispatchEvent(new CustomEvent('hs-toggle-mobile-panel', { detail: { key: k } }));
            await new Promise((r) => setTimeout(r, 1600));
        }, key);
    };

    const play = await cdp.call(() => ({
        playing: false,
        note: 'start',
    }));
    console.log('▸ 起始：' + JSON.stringify(play));
    await probe('起始');

    // 1) 确保分屏（轨道 + 参数）：先确保两者都开
    const panels = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const seen = () => ({
            timeline: Boolean(document.querySelector('[data-hs-surface="timeline"]')),
            params: Boolean(document.querySelector('[data-piano-roll-canvas]')),
        });
        const s0 = seen();
        if (!s0.timeline) {
            window.dispatchEvent(new CustomEvent('hs-toggle-mobile-panel', { detail: { key: 'timeline' } }));
            await wait(1500);
        }
        if (!seen().params) {
            window.dispatchEvent(new CustomEvent('hs-toggle-mobile-panel', { detail: { key: 'params' } }));
            await wait(1800);
        }
        return seen();
    });
    console.log('▸ 分屏状态：' + JSON.stringify(panels));
    await probe('轨道+参数 分屏');

    // 2) 切「参数界面全屏」＝ 关掉轨道面板
    await togglePanel('timeline');
    const full = await probe('参数全屏（1.6s）');
    await sleep(1600);
    const full2 = await probe('参数全屏（3.2s）');

    // 3) 来回切 3 次（"有概率"⇒ 需重复）
    for (let i = 1; i <= 3; i++) {
        await togglePanel('timeline');
        const a = await probe(`第${i}轮·切回分屏`);
        if (!a) break;
        await togglePanel('timeline');
        const b = await probe(`第${i}轮·切回全屏`);
        if (!b) break;
    }

    const pidNow = adb('shell pidof com.arounder.hifishifter').trim();
    console.log(`\n▸ 进程：${pid0} → ${pidNow || '❌ 已死'}`);
    const log = adb('logcat -d -t 1500');
    const hits = log
        .split('\n')
        .filter((l) => /chromium|RenderProcessGone|SIGSEGV|SIGABRT|libwebview|clipboard|Clipboard|FATAL|ANR|GPU|gralloc/i.test(l))
        .slice(-20);
    console.log('▸ logcat（渲染/GPU/剪贴板相关，末尾 20）：');
    for (const h of hits) console.log('   ' + h.trim().slice(0, 165));

    console.log('\n════════ 速览 ════════');
    console.log(`· 全屏时参数画布 rect：${JSON.stringify(full2?.canvasRect)}（视口 ${full2?.vw}×${full2?.vh}）`);
    console.log(`· 全屏时参数 scroller：${JSON.stringify(full2?.scrollerRect)}`);
    console.log(`· 出现「内核不可用」页：${full2?.kernelUnavailable}（复制诊断按钮：${full2?.clipBtn}）`);
    console.log(`· 0 尺寸画布数：${full2?.zeroSizedCanvases} / 共 ${full2?.canvasCount}`);
    cdp.close();
};

await main();
