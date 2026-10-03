#!/usr/bin/env node
/**
 * E37 判据 —— 顶栏（文件/编辑/轨道/视图/选项/帮助）**离系统状态栏的那段空隙**到底有多少
 * （用户 2026-10-03 口径：「菜单栏可以稍微往上挪一些，离系统状态栏有点远了……
 *   指的是 文件、编辑、轨道、视图… 距离 系统界面的时间、信号强度、摄像头留空等的距离」）。
 *
 * 为什么要量而不是估：这段空隙由**三部分**叠加，任何一处凭印象都会算错 ——
 *   ① 原生侧给 WebView 垫的 padding（E28 横屏为 0，竖屏另说）；
 *   ② 页面里 `header` 自己的 `paddingTop: env(safe-area-inset-top)`（**可能是双重留白**）；
 *   ③ 顶栏按钮 44px 命中区里"文字居中"带来的上下余量 `(44 − 行高)/2`。
 *
 * 读数：
 *   · `header.top`（页面坐标）与 `header` 的 computed `paddingTop`（= env() 的解析值，
 *     用探针 div 直接读 env 更准，见下）；
 *   · 第一个菜单按钮的 rect（`文件`）⇒ 文字中心 ≈ 按钮中心；
 *   · **文字上沿到 WebView 页面顶**的距离（= paddingTop + (btnH − fontPx)/2）。
 *
 * 用法：node scripts/_probe-e37-menubar-top.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!pid) {
    console.error('🔴 app 未运行');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

const m = await cdp.call(() => {
    const header = document.querySelector('header');
    if (!header) return null;
    const hr = header.getBoundingClientRect();
    const btn = header.querySelector('button[aria-expanded]');
    const br = btn ? btn.getBoundingClientRect() : null;
    const cs = getComputedStyle(header);
    const bcs = btn ? getComputedStyle(btn) : null;
    /* 直接读 env(safe-area-inset-top) 的解析值（组件里是内联 padding-top，取 computed 也行，
       但用一个探针 div 更干净：它就是 CSS 自己算出来的那个数）。 */
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;padding-top:env(safe-area-inset-top,0px)';
    document.body.appendChild(probe);
    const envTop = getComputedStyle(probe).paddingTop;
    probe.remove();
    return {
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        dpr: window.devicePixelRatio,
        header: { top: hr.top, h: hr.height, paddingTop: cs.paddingTop, minHeight: cs.minHeight },
        btn: br ? { top: br.top, h: br.height, cx: br.left + br.width / 2, cy: br.top + br.height / 2 } : null,
        btnFont: bcs ? bcs.fontSize : null,
        envSafeAreaTop: envTop,
        /* 文字上沿 ≈ 按钮中心 − 半个行高（字号 14 ⇒ 行高约 1.2em，取保守 0.6×字号） */
        textTopEst: br ? Math.round(br.top + br.height / 2 - Number(bcs.fontSize) * 0.6) : null,
    };
});

if (m === null) {
    console.error('🔴 页面里没有 header（应用没起来？）');
    cdp.close();
    process.exit(1);
}
console.log('▸ 顶栏几何（CSS px，页面坐标）');
console.log(`  innerH=${m.innerH} innerW=${m.innerW} dpr=${m.dpr}`);
console.log(`  header: top=${m.header.top} h=${m.header.h} paddingTop=${m.header.paddingTop} minHeight=${m.header.minHeight}`);
console.log(`  「文件」按钮: top=${m.btn.top} h=${m.btn.h} 中心y=${m.btn.cy} 字号=${m.btnFont}`);
console.log(`  env(safe-area-inset-top) 解析值 = ${m.envSafeAreaTop}`);
console.log(`  ⇒ 文字上沿估计 y ≈ ${m.textTopEst}（页面顶起算）`);

/* 顶部一条截图存盘，肉眼复核用（CDP 的 clip 拿页面坐标）。 */
try {
    const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: Math.min(m.innerW, 400), height: Math.min(m.innerH, 120), scale: 3 },
    });
    const out = 'D:/hifishifter-out/_menubar-top.png';
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`  ⇒ 顶部 120px 的截图已存：${out}`);
} catch (e) {
    console.log(`  （截图失败：${String(e).slice(0, 80)}）`);
}
cdp.close();
