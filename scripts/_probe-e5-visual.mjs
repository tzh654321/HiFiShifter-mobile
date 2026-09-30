#!/usr/bin/env node
/**
 * E5 视觉补验（规格 `docs/15` E 列）：
 *   ① **长按**（不划动）⇒「其上方出现淡入/淡出图标，下方出现变速缩放图标」
 *      ⇒ 内核 `onClipEdgeLongPressHint` 渲染的 `[data-hs-edge-longpress-hint]`
 *        里应有 `[data-hs-edge-hint="fade"]` 与 `[data-hs-edge-hint="stretch"]` 两个。
 *   ② **上下移动** ⇒「圆点的样式会带有对应的功能的图标」
 *      ⇒ 圆点的 `data-hs-control-mode` 应变为 `fade`（上移）/ `rate`（下移），且内部有 SVG。
 *
 * 用法：node scripts/_probe-e5-visual.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

/* 🔴 必须用**触摸**：内核的长按提示被 `event.pointerType === "touch"` 门控
   （`timelineKernelHost` 的 `TOUCH_EDGE_HOLD_MS` 分支）—— 鼠标/笔不参与（它们有物理 Alt）。
   用鼠标长按 ⇒ `edgeLongPress` 压根不建，`[data-hs-edge-longpress-hint]` 永远不出现。 */
const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
            type === 'touchEnd'
                ? []
                : [{ id: 0, x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 }],
    });
const press = (x, y) => touch('touchStart', x, y);
const move = (x, y) => touch('touchMove', x, y);
const release = () => touch('touchEnd', 0, 0);
const setTouch = (on) =>
    cdp.send('Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: 5 });
await setTouch(true);

/** 读：圆点位置 / 模式 / 图标数量 / 长按提示。 */
const probe = () =>
    cdp.call(() => {
        const dot = document.querySelector('[data-hs-clip-control-point="right"]');
        const hint = document.querySelector('[data-hs-edge-longpress-hint]');
        const dots = [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => ({
            side: el.getAttribute('data-hs-clip-control-point'),
            mode: el.getAttribute('data-hs-control-mode'),
            svg: el.querySelectorAll('svg').length,
        }));
        return {
            dots,
            hintExists: Boolean(hint),
            hintSide: hint ? hint.getAttribute('data-hs-edge-side') : null,
            hintKinds: hint ? [...hint.querySelectorAll('[data-hs-edge-hint]')].map((e) => e.getAttribute('data-hs-edge-hint')) : [],
            dotRightRect: dot
                ? (() => {
                      const r = dot.getBoundingClientRect();
                      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  })()
                : null,
        };
    });

/* 前置：确保有块且已选中（点块中点）。 */
let s = await probe();
if (!s.dotRightRect) {
    /* 直接点第一行的块体（y = 行顶 + 45）。 */
    const row = await cdp.call(() => {
        const r = document.querySelector('[data-hs-track-row]');
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        return r && vp ? { y: Math.round(r.getBoundingClientRect().top + 45), x: Math.round(vp.containerRect.left + 60) } : null;
    });
    if (row) {
        await press(row.x, row.y);
        await sleep(70);
        await release();
        await sleep(700);
    }
    s = await probe();
}
console.log('▸ 前置圆点：' + JSON.stringify(s.dots) + ' rect=' + JSON.stringify(s.dotRightRect));
if (!s.dotRightRect) {
    console.log('🔴 圆点不在 ⇒ 无法继续（先确认已选中块且块右缘在容器内）');
    cdp.close();
    process.exit(1);
}

/* ① 长按不划动 ⇒ 两个图标 */
const p = s.dotRightRect;
await press(p.x, p.y);
await sleep(760);
const held = await probe();
console.log(`▸ 长按中：hint=${held.hintExists} side=${held.hintSide} kinds=${JSON.stringify(held.hintKinds)}`);
/* 顺便验 ② 上移 ⇒ 圆点带 fade 图标 */
await move(p.x, p.y - 40);
await sleep(160);
const up = await probe();
/* 下移 ⇒ rate 图标 */
await move(p.x, p.y + 40);
await sleep(160);
const down = await probe();
await release();
await sleep(300);

const upDot = up.dots.find((d) => d.side === 'right') ?? {};
const downDot = down.dots.find((d) => d.side === 'right') ?? {};
const ok1 = held.hintExists && held.hintKinds.includes('fade') && held.hintKinds.includes('stretch');
const ok2 = upDot.mode === 'fade' && upDot.svg >= 1;
const ok3 = downDot.mode === 'rate' && downDot.svg >= 1;
console.log(`\n${ok1 ? '✅' : '🔴'} 长按 ⇒ 上方淡入/淡出 + 下方变速 两个图标都出现`);
console.log(`      hint=${held.hintExists} kinds=${JSON.stringify(held.hintKinds)}`);
console.log(`${ok2 ? '✅' : '🔴'} 上移 ⇒ 圆点带 fade 图标（mode=${upDot.mode} svg=${upDot.svg}）`);
console.log(`${ok3 ? '✅' : '🔴'} 下移 ⇒ 圆点带 rate 图标（mode=${downDot.mode} svg=${downDot.svg}）`);
console.log(`\n通过 ${[ok1, ok2, ok3].filter(Boolean).length} / 3`);
cdp.close();
