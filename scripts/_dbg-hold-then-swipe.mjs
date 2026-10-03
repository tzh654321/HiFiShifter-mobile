#!/usr/bin/env node
/**
 * 真相脚本：把"按住圆点 → 上划"的过程**全量打点**，一次回答三件事：
 *   1. `ClipControlPoints` 的 `onDown` 有没有建立 grab（看 `data-hs-control-mode`
 *      与圆点 scale 在移动后变不变；同时记 pointerdown 的 `isPrimary`/`cursor`）；
 *   2. `pointermove` 到底有没有到 window（计数）；
 *   3. 内核那边 fade 有没有真正写入（`__hsClipProbe`）。
 *
 * 用法：node scripts/_dbg-hold-then-swipe.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9225;

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const dot = (side) => {
            const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                mode: el.getAttribute('data-hs-control-mode'),
                dragging: el.getAttribute('data-hs-control-dragging') ?? null,
                scale: cs.scale,
                bg: cs.backgroundColor,
            };
        };
        const clip = st.clips[0] ?? null;
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const cr = vp ? vp.containerRect : null;
        const rowTop = 81;
        const left = clip && vp ? cr.left + clip.start_sec * vp.pxPerSec - vp.scrollLeft : 0;
        const right = clip && vp ? left + clip.length_sec * vp.pxPerSec : 0;
        const kern = document.querySelector('[data-hs-timeline-kernel="1"]');
        const pr = window.__hsClipProbe ? window.__hsClipProbe() : null;
        return {
            preview: pr ? pr.clip : null,
            left: Math.round(left),
            right: Math.round(right),
            rowY: rowTop + 48,
            sel: window.__hsSelection ? window.__hsSelection() : null,
            dotRight: dot('right'),
            dotLeft: dot('left'),
            cursor: kern ? kern.style.cursor || '(none)' : '(no kernel)',
            fadeIn: clip ? clip.fade_in_sec ?? 0 : null,
            fadeOut: clip ? clip.fade_out_sec ?? 0 : null,
            autoIn: clip ? clip.auto_fade_in_sec ?? 0 : null,
            autoOut: clip ? clip.auto_fade_out_sec ?? 0 : null,
            len: clip ? Number(clip.length_sec.toFixed(4)) : null,
            rate: clip ? clip.clip_playback_rate ?? clip.playback_rate : null,
            pd: window.__pd ?? null,
            pm: window.__pm ?? 0,
            hint: (() => { const h = document.querySelector('[data-hs-edge-longpress-hint]'); return h ? h.getAttribute('data-hs-edge-side') : null; })(),
        };
    });
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch { /* ignore */ }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const snap = () => cdp.call(inPage);

    /* 装记录器：pointerdown 的字段 + pointermove 计数（捕获阶段，能看到全部）。 */
    await cdp.call(() => {
        window.__pd = [];
        window.__pm = 0;
        window.addEventListener('pointerdown', (e) => {
            window.__pd.push({ primary: e.isPrimary, pt: e.pointerType, id: e.pointerId, x: e.clientX, y: e.clientY });
        }, true);
        window.addEventListener('pointermove', () => { window.__pm += 1; }, true);
    });

    let base = await snap();
    if (!base.dotRight && !base.dotLeft) {
        console.log('（没有圆点 ⇒ 先点一下块中心把它选中）left =', base.left, ' right =', base.right, ' sel =', JSON.stringify(base.sel));
        const mx = Math.round((base.left + base.right) / 2);
        await touch('touchStart', [{ x: mx, y: base.rowY }]);
        await sleep(90);
        await touch('touchEnd', []);
        await sleep(800);
        base = await snap();
    }
    const d = base.dotRight ?? base.dotLeft;
    console.log('── 基线 ──');
    console.log('  dot =', JSON.stringify(d), ' fadeIn =', base.fadeIn, ' fadeOut =', base.fadeOut, ' len =', base.len, ' rate =', base.rate);
    if (!d) { cdp.close(); return; }

    console.log('── 1) 按住 600ms（跨过内核 500ms 门槛）──');
    await touch('touchStart', [{ x: d.x, y: d.y }]);
    await sleep(600);
    const r1 = await snap();
    console.log('  dot =', JSON.stringify({ mode: r1.dotRight?.mode, scale: r1.dotRight?.scale, dragging: r1.dotRight?.dragging }));
    console.log('  hint =', r1.hint, ' pd =', JSON.stringify(r1.pd), ' pm =', r1.pm);

    console.log('── 2) 纵向上划 4 步 × 10px ──');
    for (let i = 1; i <= 4; i += 1) {
        await touch('touchMove', [{ x: d.x, y: d.y - 10 * i }]);
        await sleep(60);
        const s = await snap();
        console.log(`  step${i} y=${d.y - 10 * i} mode=${s.dotRight?.mode} cursor=${s.cursor} fadeIn=${s.fadeIn} fadeOut=${s.fadeOut} autoIn=${s.autoIn} autoOut=${s.autoOut} len=${s.len} rate=${s.rate} pm=${s.pm}`);
    }
    console.log('── 3) 横向**向左** 8 步 × 10px（规格：定型后横滑调值；右控制点=淡出 ⇒ 向左为变长）──');
    for (let i = 1; i <= 8; i += 1) {
        await touch('touchMove', [{ x: d.x - 10 * i, y: d.y - 40 }]);
        await sleep(70);
        const s = await snap();
        console.log(`  L${i} x=${d.x - 10 * i} cursor=${s.cursor} 后端fadeOut=${s.fadeOut} **Redux预览=${JSON.stringify(s.preview && { fi: s.preview.fadeInSec, fo: s.preview.fadeOutSec })}** len=${s.len}`);
    }
    await touch('touchEnd', []);
    await sleep(800);
    const after = await snap();
    console.log('── 结果 ──  fadeIn =', after.fadeIn, ' fadeOut =', after.fadeOut, ' autoIn =', after.autoIn, ' autoOut =', after.autoOut, ' len =', after.len, ' rate =', after.rate);
    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
