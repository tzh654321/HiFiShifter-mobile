#!/usr/bin/env node
/**
 * I-4（E10-② 白屏）专项复现与量化。
 *
 * 用户口径：「参数界面全屏：白屏 + 灰框哭脸，**反复切换全屏/分屏后**出现」。
 *
 * 本脚本反复切换（全屏 ⇄ 分屏）若干轮，同时量化三件事：
 *   ① **空渲染警告**条数（`Render count or primcount is 0`）—— 验证第一刀（count<=0 不调 draw）；
 *   ② **WebGL context 丢失**次数（`CONTEXT_LOST_WEBGL` / `webglcontextlost` / `Context Lost`）
 *      —— 验证第二刀（自愈）是否被触发；
 *   ③ 是否出现**白屏 / 内核不可用页**（`时间轴无法渲染` / 页面是否还能求值）。
 *
 * 用法：node scripts\_probe-i4-white-screen.mjs [serial] [rounds]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const ROUNDS = Number(process.argv[3] ?? 12);

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    adb('logcat -c');
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    /** 每轮：切成全屏（只留参数）→ 再切回分屏（开轨道）。 */
    const toggle = (which) =>
        cdp.call(async (w) => {
            window.dispatchEvent(new CustomEvent('hs-open-settings', { detail: {} }));
            // 用 App 的事件桥切换面板：先关掉无关的，再打开目标
            const fire = (tab) =>
                window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab } }));
            if (w === "params-only") {
                // 关文件/记事本（如果开着），再切到参数
                fire("params");
            } else {
                fire("timeline");
            }
            await new Promise((r) => setTimeout(r, 400));
        }, which);

    const probe = async () =>
        cdp.call(() => {
            const txt = document.body.innerText || '';
            const canvases = [...document.querySelectorAll('canvas')].map((c) => c.width * c.height);
            return {
                kernelUnavailable: /时间轴无法渲染|WebGL2 不可用/.test(txt),
                canvasCount: canvases.length,
                zeroSized: canvases.filter((v) => v === 0).length,
                dots: document.querySelectorAll('[data-hs-clip-control-point]').length,
            };
        }).catch(() => null); // 求值失败 = 页面可能已白屏/卡死

    const results = [];
    for (let i = 1; i <= ROUNDS; i++) {
        await toggle("params-only");
        await toggle("full");
        const p = await probe();
        results.push({ round: i, ok: p !== null, kernelUnavailable: p?.kernelUnavailable ?? null });
        if (i % 3 === 0) console.log(`  第 ${i} 轮：页面响应=${p !== null} 内核不可用页=${p?.kernelUnavailable} 画布=${p?.canvasCount}`);
        if (p === null) {
            console.log(`🔴 第 ${i} 轮后页面**求值失败**（疑似白屏/卡死）`);
            break;
        }
    }

    const log = adb('logcat -d');
    const count = (re) => log.split('\n').filter((l) => re.test(l)).length;
    const zeroDraw = count(/Render count or primcount is 0/);
    const lost = count(/CONTEXT_LOST_WEBGL|context lost|webglcontextlost|Context Lost/i);
    const gone = count(/RenderProcessGone|GPU process|gralloc|SIGSEGV/i);
    const alive = adb('shell pidof com.arounder.hifishifter').trim();

    console.log('\n════════ 汇总 ════════');
    console.log(`轮次：${results.length}/${ROUNDS}（每轮 = 全屏 ⇄ 分屏 各一次）`);
    console.log(`① 空渲染警告 "Render count is 0"：${zeroDraw} 条   ← 第一刀应使其为 0 或极少`);
    console.log(`② WebGL context 丢失相关：${lost} 条   ← 第二刀在此触发说明确实丢过`);
    console.log(`③ 渲染进程崩溃/GPU 相关：${gone} 条`);
    console.log(`进程：${alive ? '存活 ' + alive : '❌ 已死'}`);
    console.log(`内核不可用页出现：${results.filter((r) => r.kernelUnavailable).length} 轮`);
    const fail = results.filter((r) => !r.ok).length;
    console.log(`\n判读：求值失败=${fail} 轮（>0 ⇒ 白屏复现）；空渲染警告=${zeroDraw}（越低越好）`);
    cdp.close();
};

await main();
