#!/usr/bin/env node
/**
 * 复刻探针 CP1 的精确动作（5 步 × 10px、步间 sleep 45ms），逐帧打印 cursor 与 clip，
 * 与 `_dbg-edge-vs-dot.mjs`（6 步 × 8.3px、步间带一次 CDP 往返）对照 ——
 * 定位"探针红、诊断绿"的差异到底在步长、时序，还是前置状态。
 *
 * 用法：node scripts/_dbg-cp-repro.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9224;

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const c = vp.containerRect;
        const clip = st.clips[0] ?? null;
        const left = clip ? c.left + clip.start_sec * vp.pxPerSec - vp.scrollLeft : 0;
        const right = clip ? left + clip.length_sec * vp.pxPerSec : 0;
        const dot = (side) => {
            const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        };
        const kern = document.querySelector('[data-hs-timeline-kernel="1"]');
        return {
            left: Math.round(left),
            right: Math.round(right),
            pxPerSec: Number(vp.pxPerSec.toFixed(2)),
            cursor: kern ? kern.style.cursor || '(none)' : '(no kernel)',
            dotRight: dot('right'),
            dotLeft: dot('left'),
            clip: clip && {
                startSec: Number(clip.start_sec.toFixed(4)),
                lengthSec: Number(clip.length_sec.toFixed(4)),
                sourceStartSec: Number(clip.source_start_sec.toFixed(4)),
            },
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

    const base = await snap();
    console.log('── 基线 ──');
    console.log('  clip =', JSON.stringify(base.clip), `left=${base.left} right=${base.right} px/s=${base.pxPerSec}`);
    console.log('  dotRight =', JSON.stringify(base.dotRight), ' dotLeft =', JSON.stringify(base.dotLeft));
    console.log('  cursor =', base.cursor);

    const d = base.dotRight ?? base.dotLeft;
    if (!d) { console.log('（无圆点）'); cdp.close(); return; }
    const dx = 50;
    const steps = 5;
    console.log(`── 复刻探针：起手 ${JSON.stringify(d)}，${steps} 步 × ${dx / steps}px，步间 sleep 45ms ──`);
    await touch('touchStart', [{ x: d.x, y: d.y }]);
    for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', [{ x: d.x + (dx * i) / steps, y: d.y }]);
        await sleep(45);
        const s = await snap();
        console.log(`   step${i} x=${Math.round(d.x + (dx * i) / steps)} cursor=${s.cursor} len=${s.clip?.lengthSec} start=${s.clip?.startSec}`);
    }
    await touch('touchEnd', []);
    await sleep(900);
    const after = await snap();
    console.log('   after =', JSON.stringify(after.clip));
    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
