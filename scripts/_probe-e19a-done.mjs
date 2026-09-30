#!/usr/bin/env node
/**
 * E19a 收口：在 `compose_enabled = true` 的前提下（上一轮确认的根因），
 * 走完整链路：写基线 → 长按绘制选「还原」→ 拖动擦除 → 比对 `edit` 非零帧。
 *
 * 判据：被擦除的帧**跨越整段拖动**（Δ > 10）⇒ 拖动生效；
 *       Δ 只有 1~3 ⇒ 复现用户报的"只能点一个点"。
 *
 * 用法：node scripts\_probe-e19a-done.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const FRAMES = 1200;

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const check = (n, ok, d) => console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });
    const invoke = (cmd, args) =>
        cdp.call((c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 120) })), cmd, args);

    // ① 确保 compose 打开 + 有块
    const setup = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 120) }));
        const st0 = await inv('get_timeline_state', {});
        if (!(st0?.clips || []).length) {
            await inv('import_audio_item', { audioPath: '/sdcard/Download/test-rr.wav', trackId: null, startSec: 0, mediaAudioStreamIndex: null });
            await new Promise((r) => setTimeout(r, 3000));
        }
        /* ⚠️ 参数必须写在**块所在的轨道**上：`commitStroke` 用的是 `rootTrackId`
           （= 当前编辑轨道），而导入的块常落在**新建轨道** ⇒ 硬编码 `track_main`
           会让"写 A / 读 A"与"提交到 B"错位，判据永远 Δ0（本次实测就是这样）。 */
        const trackId = (st0?.clips || [])[0]?.track_id ?? 'track_main';
        await inv('set_track_state', { trackId, composeEnabled: true });
        await new Promise((r) => setTimeout(r, 1500));
        const st = await inv('get_timeline_state', {});
        const t = (st?.tracks || []).find((x) => x.id === trackId) ?? (st?.tracks || [])[0];
        return { clips: (st?.clips || []).length, compose: t?.compose_enabled ?? null, trackId, algo: t?.pitch_analysis_algo ?? null };
    });
    console.log('前置：' + JSON.stringify(setup));
    check('E19a-0 有块且 compose 已开', setup.clips > 0 && setup.compose === true, JSON.stringify(setup));

    // ② 切参数面板 + 写基线
    /* ⚠️ 必须先**点亮块所在轨道的轨道头**：参数面板编辑的是钢琴窗的 rootTrackId
       （= `selectedTrackId ?? tracks[0]`），没选中时会回退到 `tracks[0]`（空的 Main）——
       而空轨上 `set_param_frames` 虽然回 `ok:true`、`get_param_frames` 的 `edit` 却恒为
       `[]`（写进去不存）⇒ 拖动"提交成功"但读数永远 Δ0。（本次实测就是这样：
       未选轨时 0 IPC / Σ差 0；选轨后同一动作 Σ差 13295。） */
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
        await new Promise((r) => setTimeout(r, 2500));
    });
    const rowRect = await cdp.call((tk) => {
        const el = document.querySelector(`[data-hs-track-row="${tk}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + 30), y: Math.round(r.top + Math.min(20, r.height / 2)) };
    }, setup.trackId);
    console.log('轨道头：' + JSON.stringify(rowRect));
    if (rowRect) {
        await touch('touchStart', [{ id: 0, x: rowRect.x, y: rowRect.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1200);
    }
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 3000));
    });
    const values = Array.from({ length: FRAMES }, (_, i) => Math.sin(i / 30) * 250);
    await invoke('set_param_frames', { trackId: setup.trackId, param: 'pitch', startFrame: 0, values, checkpoint: false });
    await sleep(2000);
    const readParam = async () => {
        const res = await invoke('get_param_frames', { trackId: setup.trackId, param: 'pitch', startFrame: 0, frameCount: FRAMES, stride: 1 });
        const edit = Array.isArray(res?.edit) ? res.edit : [];
        const idxs = [];
        edit.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v) && v !== 0) idxs.push(i); });
        return { len: edit.length, nonZero: idxs.length, first: idxs[0] ?? null, last: idxs[idxs.length - 1] ?? null };
    };
    const base = await readParam();
    console.log('基线：' + JSON.stringify(base));
    check('E19a-1 基线可读（非零 > 500）', (base.nonZero ?? 0) > 500, JSON.stringify(base));

    // ③ 长按绘制 →「还原」
    let restoreAt = null;
    for (let attempt = 1; attempt <= 3 && !restoreAt; attempt++) {
        const draw = await cdp.call(() => {
            const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]') ?? document;
            const el = [...bar.querySelectorAll('button')].find((x) => /绘制/.test((x.getAttribute('data-tooltip') || '') + (x.getAttribute('aria-label') || '')));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!draw) { await sleep(1500); continue; }
        await touch('touchStart', [{ id: 0, x: draw.x, y: draw.y }]);
        for (let i = 0; i < 6; i++) { await sleep(90); await touch('touchMove', [{ id: 0, x: draw.x, y: draw.y }]); }
        await sleep(140);
        await touch('touchEnd', []);
        await sleep(1300);
        restoreAt = await cdp.call(() => {
            const el = [...document.querySelectorAll('button,[role=menuitem]')].find((x) => (x.textContent || '').trim() === '还原');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        console.log(`  第 ${attempt} 次长按 → 「还原」=${JSON.stringify(restoreAt)}`);
        if (!restoreAt) await sleep(1600);
    }
    check('E19a-2 能选中「还原」工具', Boolean(restoreAt), JSON.stringify(restoreAt));
    if (restoreAt) {
        await touch('touchStart', [{ id: 0, x: restoreAt.x, y: restoreAt.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1400);
    }

    // ④ 参数画布拖动擦除
    /* ⚠️ 必须用**真宿主** [data-piano-roll-canvas]（pointer-events:auto）——
       参数面板里有 7 个同尺寸 canvas 叠加，按"面积最大"会选到 pe:none 的叠加层，
       派发过去的事件不会被处理（这个坑在本项目已坑了三次）。 */
    const canvas = await cdp.call(() => {
        const el = document.querySelector('[data-piano-roll-canvas]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(el).pointerEvents };
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const x0 = canvas.x + 20;
        const y0 = canvas.y + Math.round(canvas.h * 0.5);
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(150);
        for (let i = 1; i <= 26; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 12) }]);
            await sleep(55);
        }
        await touch('touchEnd', []);
        await sleep(2200);
        console.log('已拖动约 260px（26 次 move）');
    }
    const after = await readParam();
    console.log('拖动后：' + JSON.stringify(after));
    const delta = (base.nonZero ?? 0) - (after.nonZero ?? 0);
    check('E19a-3 「还原」拖动可**连续擦除**（Δ > 10）', delta > 10, `非零帧 ${base.nonZero} → ${after.nonZero}（Δ${delta}）`);
    if (delta > 0 && delta <= 5) console.log('⚠️ Δ 很小 ⇒ 复现用户报的"只能点一个点"');
    cdp.close();
};

await main();
