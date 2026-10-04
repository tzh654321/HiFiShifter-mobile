#!/usr/bin/env node
/** 现场诊断：控制点 `setGrab` 到底有没有跑（读 `data-hs-control-dragging` / `-mode`）。 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const wav = 'D:\\Temp\\hs-tone.wav';

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);

const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {}

const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
    });

/* 清空 + 导入 + 选中 */
await cdp.call(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.ariaLabel === '停止');
    if (btn) btn.click();
});
await sleep(500);
for (let i = 0; i < 4; i++) {
    const n = await cdp.call(() => (window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => s.clips.length)));
    if (n === 0) break;
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(800);
}
const b64 = readFileSync(wav).toString('base64');
await cdp.call((b) => window.__hsImportAudioBase64('diag.wav', b, 0), b64);
await sleep(1600);
/* 缩放一点，让块左右都有空间 */
await cdp.call(() => window.dispatchEvent(new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: 0.6 } })));
await sleep(400);

const dots = await cdp.call(() =>
    [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
            side: el.getAttribute('data-hs-clip-control-point'),
            cx: Math.round(r.left + r.width / 2),
            cy: Math.round(r.top + r.height / 2),
            mode: el.getAttribute('data-hs-control-mode'),
        };
    }),
);
console.log('圆点：', JSON.stringify(dots));
const dot = dots.find((d) => d.side === 'left') ?? dots[0];
if (!dot) {
    console.log('没有圆点');
    cdp.close();
    process.exit(1);
}

const read = async (tag, side = 'left') => {
    const st = await cdp.call((sd) => {
        const el =
            document.querySelector(`[data-hs-clip-control-point="${sd}"]`) ??
            document.querySelector('[data-hs-clip-control-point]');
        return el
            ? {
                  side: el.getAttribute('data-hs-clip-control-point'),
                  mode: el.getAttribute('data-hs-control-mode'),
                  dragging: el.getAttribute('data-hs-control-dragging'),
                  top: Math.round(el.getBoundingClientRect().top),
              }
            : null;
    }, side);
    console.log(`  ${tag}: ${JSON.stringify(st)}`);
    return st;
};

console.log('起手：', dot.cx, dot.cy);
/* 装一层 window 捕获监听：确认 pointerdown/move 到底有没有到 window、isPrimary 是什么。 */
await cdp.call(() => {
    const w = window;
    w.__diag = [];
    const rec = (tag) => (e) => {
        if (w.__diag.length > 60) return;
        w.__diag.push({
            tag,
            t: e.pointerType,
            primary: e.isPrimary,
            x: Math.round(e.clientX),
            y: Math.round(e.clientY),
            target: e.target && e.target.tagName,
        });
    };
    w.addEventListener('pointerdown', rec('down'), true);
    w.addEventListener('pointermove', rec('move'), true);
    w.addEventListener('pointerup', rec('up'), true);
});
/* 另外记录 `hs-hide-clip-actions`（它在 baseX 闸门**之前**派发 ⇒ 可判"处理器跑没跑到那里"）。 */
await cdp.call(() => {
    window.__hideCount = 0;
    window.addEventListener('hs-hide-clip-actions', () => {
        window.__hideCount += 1;
    });
});
await touch('touchStart', [{ x: dot.cx, y: dot.cy }]);
await sleep(150);
await read('down+150ms');
await sleep(700);
await read('hold 850ms');
for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [{ x: dot.cx, y: dot.cy - (40 * i) / 4 }]);
    await sleep(60);
    await read(`上划 ${i}/4`);
}
await touch('touchEnd', []);
await sleep(300);
await read('up');
console.log('hideCount =', await cdp.call(() => window.__hideCount));
const diag = await cdp.call(() => window.__diag);
console.log('event 轨迹（前 8 条）：', JSON.stringify(diag.slice(0, 8)));

/* ── 第二段：fade 编辑到底行不行（上划进 fade 轨 → **向右**横滑 → 提交）── */
const clipOf = () =>
    cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const c = (s.clips || [])[0];
            return c ? { fadeInSec: c.fade_in_sec ?? c.fadeInSec, fadeOutSec: c.fade_out_sec ?? c.fadeOutSec, rate: c.clip_playback_rate ?? c.playback_rate } : null;
        }),
    );
console.log('fade 前：', JSON.stringify(await clipOf()));
const d2 = await cdp.call(() =>
    [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { side: el.getAttribute('data-hs-clip-control-point'), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
    }),
);
/* 用**左**圆点（fade-IN 在块左端）⇒ 上划进 fade 轨，再**向右**（往块内）滑 ⇒ fadeIn 应变大。
   ⚠️ 起始 `fadeInSec=0`：向北/向左拖都被钳在 0，看不出变化（这正是 CP2 假红的成因嫌疑）。 */
const dot2 = d2.find((d) => d.side === 'left') ?? d2[0];
console.log('第二段用圆点：', JSON.stringify(dot2));
await touch('touchStart', [{ x: dot2.cx, y: dot2.cy }]);
await sleep(120);
await sleep(700);
for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [{ x: dot2.cx, y: dot2.cy - (40 * i) / 4 }]);
    await sleep(55);
}
await read('fade-上划到底', dot2.side);
/* 🔑 向右拖（= 往块内）—— fade 应该变长。 */
for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [{ x: dot2.cx + (60 * i) / 5, y: dot2.cy - 40 }]);
    await sleep(55);
}
await read('fade-右滑后', dot2.side);
await touch('touchEnd', []);
await sleep(1400);
console.log('fade 后：', JSON.stringify(await clipOf()));
cdp.close();
