#!/usr/bin/env node
/**
 * E10 复现与取证：**从「轨道+参数」分屏切到「参数界面全屏」**。
 *
 * 用户口径（E10）：
 *   「从轨道+参数分屏切换到参数界面全屏会出现参数界面**无法占满全屏**，
 *     且有概率把参数界面**卡崩**（全白，左上角显示灰框哭脸），
 *     且有概率使状态栏闪烁"剪贴板没有可粘贴的内容"。」
 *
 * 本脚本做三件事：
 *   ① 按用户路径复现（视图菜单：只勾参数面板 = 参数界面全屏）；
 *   ② 每一步量测参数面板相对视口的占比（是否占满）+ 页面是否还能响应（崩溃检测）；
 *   ③ 全程采集 logcat 里的渲染进程崩溃 / 剪贴板相关关键字。
 *
 * 用法：node scripts\_probe-e10-params-fullscreen.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const alive = () => adb('shell pidof com.arounder.hifishifter').trim();
    const pid0 = alive();
    if (!pid0) {
        console.log('🔴 应用没在运行，先 am start 再跑本脚本');
        return;
    }
    adb('logcat -c');
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid0);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    /** 量：面板可见性 / 参数面板占比 / 页面是否还能响应。 */
    const probe = async (label) => {
        let ok = true;
        let data = null;
        try {
            data = await cdp.call(() => {
                const rect = (s) => {
                    const el = document.querySelector(s);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
                };
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const pr = rect('[data-hs-surface="params"]');
                return {
                    vw,
                    vh,
                    params: pr,
                    paramsCoverage: pr ? Math.round(((pr.w * pr.h) / (vw * vh)) * 100) : null,
                    timelineVisible: Boolean(rect('[data-hs-surface="timeline"]')),
                    bodyTextLen: (document.body.innerText || '').length,
                    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height })),
                };
            });
        } catch (e) {
            ok = false;
            data = { error: String(e).slice(0, 120) };
        }
        console.log(`▸ [${label}] 响应=${ok ? '正常' : '❌ 无响应'} ${JSON.stringify(data)}`);
        return { ok, data };
    };

    const openViewMenuPick = async (name) => {
        await cdp.call(async (n) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            trig && trig.click();
            await wait(900);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) => ((x.getAttribute('aria-label') || '').trim() === n || (x.textContent || '').trim() === n) && x.children.length <= 3,
            );
            if (it) {
                it.click();
                await wait(1800);
                return true;
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return false;
        }, name);
    };

    await probe('起始');

    // 步骤 1：先做成「轨道 + 参数」分屏
    await openViewMenuPick('轨道面板');
    await sleep(600);
    await openViewMenuPick('参数面板');
    await sleep(900);
    const split = await probe('轨道+参数 分屏');

    // 步骤 2：切到「参数界面全屏」＝ 取消轨道面板（只留参数）
    await openViewMenuPick('轨道面板');
    await sleep(1200);
    const full = await probe('参数界面全屏');
    await sleep(1500);
    const full2 = await probe('参数界面全屏（1.5s 后）');

    // 步骤 3：再来回切几次（用户说"有概率"崩 ⇒ 需要反复）
    for (let i = 1; i <= 3; i++) {
        await openViewMenuPick('轨道面板');
        await sleep(900);
        const a = await probe(`第 ${i} 次切回分屏`);
        if (!a.ok) break;
        await openViewMenuPick('轨道面板');
        await sleep(900);
        const b = await probe(`第 ${i} 次切回全屏`);
        if (!b.ok) break;
    }

    const pidNow = alive();
    console.log(`\n▸ 进程：起始 pid=${pid0} → 现在 ${pidNow || '❌ 已死（崩溃）'}`);

    // 取证：logcat 关键行
    const log = adb('logcat -d -t 1200');
    const keys = /chromium|RenderProcessGone|SIGSEGV|SIGABRT|libwebview|WebView|clipboard|Clipboard|FATAL|ANR|died/i;
    const hits = log.split('\n').filter((l) => keys.test(l)).slice(-28);
    console.log('▸ logcat 关键字命中（末尾 28 行）：');
    for (const h of hits) console.log('   ' + h.trim().slice(0, 168));

    console.log('\n════════ 结论速览 ════════');
    console.log(`· 分屏时参数面板占比：${split.data?.paramsCoverage ?? 'n/a'}%`);
    console.log(`· 全屏时参数面板占比：${full2.data?.paramsCoverage ?? 'n/a'}%（应为 ~100%，含顶栏/底栏则略低）`);
    console.log(`· 页面是否全程响应：${full2.ok ? '是' : '❌ 否（疑似卡崩）'}`);
    cdp.close();
};

await main();
