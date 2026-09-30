#!/usr/bin/env node
/**
 * E19a 第三层诊断：**参数面板的拖动到底有没有提交到后端**。
 *
 * 【为什么需要】前两层（`_dbg-e19a-events.mjs`）已经证明：
 *   · 触摸事件 20 个 `pointermove`（buttons=1）全部命中 `prCanvas`、无 pointercancel；
 *   · 但拖动期间**没有任何 param 类 IPC**。
 * 那"没有 IPC"到底是"守卫拦掉提交"还是"读错了轨道"分不出 —— 本脚本把两侧都钉死：
 *
 * ① 轨道对齐：参数面板编辑的是**钢琴窗的 rootTrackId**
 *    （`resolveRootTrackId(tracks, effectiveSelectedTrackId)`，无选中时回退 `tracks[0]`）。
 *    实测 `track_main`（空轨、无块）上 `set_param_frames` 返回 `ok:true` 但
 *    `get_param_frames` 的 `edit` 恒为 `[]` ⇒ **写进去也不存**。所以必须让
 *    **块所在轨道被选中**（点它的轨道头），rootTrackId 才会指向它。
 * ② 读数用**逐帧差分**（`Σ|aᵢ−bᵢ|`）而不是"非零帧个数"：绘制模式是**覆写**曲线，
 *    非零个数不变 ⇒ 旧指标对绘制模式恒 Δ0（误导）。
 *
 * 用法：node scripts/_dbg-param-commit.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const FRAMES = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}
const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 6,
            radiusY: 6,
            force: 1,
        })),
    });
const tap = async (x, y) => {
    await touch('touchStart', [{ x, y }]);
    await sleep(70);
    await touch('touchEnd', []);
};

/* 1. 找到"块所在的轨道" */
const trackId = await cdp.call(async () => {
    const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {}).catch(() => null);
    return (st?.clips || [])[0]?.track_id ?? null;
});
if (!trackId) {
    console.log('🔴 没有块 ⇒ 先跑 _dbg-import-drag.mjs 造一个');
    cdp.close();
    process.exit(1);
}
console.log('▸ 块所在轨道：' + trackId);

/* 2. 让轨道面板在场并**点它的轨道头**（⇒ selectedTrackId = 该轨 ⇒ rootTrackId 跟着走） */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    await new Promise((r) => setTimeout(r, 2500));
});
const row = await cdp.call((tk) => {
    const el = document.querySelector(`[data-hs-track-row="${tk}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
        x: Math.round(r.left + 30),
        y: Math.round(r.top + Math.min(20, r.height / 2)),
        w: Math.round(r.width),
        h: Math.round(r.height),
    };
}, trackId);
console.log('▸ 轨道头：' + JSON.stringify(row));
if (!row) {
    console.log('🔴 找不到该轨道的行（轨道面板可能被关掉/滚出可视区）');
    cdp.close();
    process.exit(1);
}
await tap(row.x, row.y);
await sleep(1200);

/* 3. 切到参数面板 */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    await new Promise((r) => setTimeout(r, 3000));
});

/* 4. 写基线（正弦） */
await cdp.call(
    async (tk) => {
        const values = Array.from({ length: 1200 }, (_, i) => Math.sin(i / 30) * 250);
        await window.__TAURI_INTERNALS__.invoke('set_param_frames', {
            trackId: tk,
            param: 'pitch',
            startFrame: 0,
            values,
            checkpoint: false,
        }).catch((e) => ({ err: String(e).slice(0, 100) }));
        await new Promise((r) => setTimeout(r, 1800));
    },
    trackId,
);

const readSum = () =>
    cdp.call(
        async (tk) => {
            const res = await window.__TAURI_INTERNALS__.invoke('get_param_frames', {
                trackId: tk,
                param: 'pitch',
                startFrame: 0,
                frameCount: 1200,
                stride: 1,
            }).catch(() => null);
            const edit = Array.isArray(res?.edit) ? res.edit : [];
            let nz = 0;
            let sum = 0;
            edit.forEach((v) => {
                if (typeof v === 'number' && Number.isFinite(v) && v !== 0) nz += 1;
                if (typeof v === 'number' && Number.isFinite(v)) sum += v;
            });
            return { len: edit.length, nz, sum };
        },
        trackId,
    );

const before = await readSum();
console.log('▸ 拖动前：' + JSON.stringify(before));
if (before.len === 0) {
    console.log('🔴 该轨道的 edit 仍为空 ⇒ 选中没生效（rootTrackId 还是别的轨）');
}

/* 5. 画布几何 + 拖动 */
const geo = await cdp.call(() => {
    const el = document.querySelector('[data-piano-roll-canvas]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        pe: getComputedStyle(el).pointerEvents,
    };
});
console.log('▸ 参数画布：' + JSON.stringify(geo));
if (!geo || geo.w < 60 || geo.h < 40) {
    console.log('🔴 参数画布过小/不存在');
    cdp.close();
    process.exit(1);
}

const x0 = geo.x + 10;
const y0 = geo.y + Math.round(geo.h * 0.5);
const step = Math.max(8, Math.round((geo.w - 20) / 20));
await touch('touchStart', [{ x: x0, y: y0 }]);
await sleep(140);
for (let i = 1; i <= 20; i++) {
    await touch('touchMove', [
        { x: x0 + i * step, y: y0 + Math.round(Math.sin(i / 2) * 10) },
    ]);
    await sleep(50);
}
await touch('touchEnd', []);
await sleep(2200);

const after = await readSum();
const dsum = Math.abs(after.sum - before.sum);
console.log('▸ 拖动后：' + JSON.stringify(after));
console.log(`▸ Δ非零=${after.nz - before.nz}  Σ差=${Math.round(dsum)}`);
console.log(
    dsum > 100 ? '✅ 提交链路**通**（后端数据被改写）' : '🔴 提交链路**不通**（后端数据未变）',
);
cdp.close();
