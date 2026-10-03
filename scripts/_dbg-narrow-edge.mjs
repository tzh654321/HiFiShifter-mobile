#!/usr/bin/env node
/**
 * 窄块（刚导入、宽 ~29px）下的边缘/控制点手势**逐帧真相**。
 *
 * 背景：`_probe-control-point.mjs` 在**刚导入的窄块**上 CP1 全红，而
 * `_dbg-edge-vs-dot.mjs` 在**被拉宽的块**上全绿 ⇒ 怀疑与"块宽"或"按下到移动的间隔"
 * 有关。本脚本重置工程后跑两种时序，各自逐帧打点：
 *   变体 1「立即拖」：touchStart → 立刻 5 步 ×10px（探针 CP1 的动作）
 *   变体 2「长按后横拖」：touchStart → 停 600ms → 5 步 ×10px（真人常见：按一下再拖）
 *
 * 页面内用 interval 采内核 cursor（不打乱 CDP 时序）。
 *
 * 用法：node scripts/_dbg-narrow-edge.mjs 221deeb
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const wav = 'D:\\Temp\\hs-tone.wav';
const port = 9226;

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const cr = vp ? vp.containerRect : null;
        const clip = st.clips[0] ?? null;
        const left = clip && vp ? cr.left + clip.start_sec * vp.pxPerSec - vp.scrollLeft : 0;
        const right = clip && vp ? left + clip.length_sec * vp.pxPerSec : 0;
        const dot = (side) => {
            const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        };
        const kern = document.querySelector('[data-hs-timeline-kernel="1"]');
        return {
            clips: st.clips.length,
            left: Math.round(left),
            right: Math.round(right),
            width: Math.round(right - left),
            pxPerSec: vp ? Number(vp.pxPerSec.toFixed(2)) : null,
            scrollLeft: vp ? Math.round(vp.scrollLeft) : null,
            containerRect: cr ? { left: cr.left, top: cr.top, width: cr.width, height: cr.height } : null,
            dotRight: dot('right'),
            dotLeft: dot('left'),
            cursor: kern ? kern.style.cursor || '(none)' : '(no kernel)',
            clip: clip && {
                startSec: Number(clip.start_sec.toFixed(4)),
                lengthSec: Number(clip.length_sec.toFixed(4)),
                sourceStartSec: Number(clip.source_start_sec.toFixed(4)),
                fadeIn: clip.fade_in_sec ?? 0,
                fadeOut: clip.fade_out_sec ?? 0,
                rate: clip.clip_playback_rate ?? clip.playback_rate,
            },
            curs: window.__curs ?? null,
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
    const armCursor = () => cdp.call(() => {
        window.__curs = [];
        window.__cursT = setInterval(() => {
            const k = document.querySelector('[data-hs-timeline-kernel="1"]');
            window.__curs.push(k ? (k.style.cursor || '-') : 'x');
        }, 25);
    });
    const stopCursor = () => cdp.call(() => { clearInterval(window.__cursT); return window.__curs; });

    /** 把横向视口拖回 0（在行区下方的空白处横拖 = 平移视野）。 */
    async function ensureScrollZero() {
        for (let i = 0; i < 30; i += 1) {
            const s = await snap();
            if (s.scrollLeft === null || s.scrollLeft <= 1) return;
            const c = s.containerRect;
            const y = Math.round(c.top + c.height - 120);
            const x0 = Math.round(c.left + 12);
            await touch('touchStart', [{ x: x0, y }]);
            for (let k = 1; k <= 6; k += 1) {
                await touch('touchMove', [{ x: Math.round(x0 + ((c.width - 24) * k) / 6), y }]);
                await sleep(30);
            }
            await touch('touchEnd', []);
            await sleep(300);
        }
    }

    /* ── 重置：清空 + 导入 2s 素材到 0.3s ── */
    for (let g = 0; g < 6; g += 1) {
        const cur = await snap();
        if (!cur.clips) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
        await sleep(900);
    }
    const b64 = readFileSync(wav).toString('base64');
    await ensureScrollZero();
    await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), 'narrow', b64, 0.3);
    await sleep(1600);
    await ensureScrollZero();

    /** 跑一个变体。 */
    async function variant(label, holdMs) {
        let s = await snap();
        const d = s.dotRight ?? s.dotLeft;
        console.log(`\n══ ${label} ══`);
        console.log(`  块 left=${s.left} right=${s.right} 宽=${s.width}px px/s=${s.pxPerSec} dot=${JSON.stringify(d)}`);
        if (!d) { console.log('  （没有圆点）'); return; }
        await armCursor();
        await touch('touchStart', [{ x: d.x, y: d.y }]);
        if (holdMs > 0) await sleep(holdMs);
        for (let i = 1; i <= 5; i += 1) {
            await touch('touchMove', [{ x: d.x + 10 * i, y: d.y }]);
            await sleep(45);
            const t = await snap();
            console.log(`   step${i} x=${d.x + 10 * i} cursor=${t.cursor} len=${t.clip?.lengthSec} start=${t.clip?.startSec}`);
        }
        await touch('touchEnd', []);
        const curs = await stopCursor();
        await sleep(800);
        const after = await snap();
        console.log(`   cursor 采样(${curs.length}) = ${JSON.stringify((curs ?? []).filter((v, i) => v !== (curs[i - 1] ?? '')).slice(0, 12))}`);
        console.log(`   after = ${JSON.stringify(after.clip)}`);
        // 复位：把块长度改回 2s 便于下一个变体（用一次裁切太慢，直接重新导入）
    }

    await variant('变体 1「立即拖」（探针 CP1 的动作）', 0);

    /* 重新导入，保证变体 2 从同样的原始状态开始 */
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(900);
    await ensureScrollZero();
    await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), 'narrow2', b64, 0.3);
    await sleep(1600);
    await ensureScrollZero();
    await variant('变体 2「长按 600ms 后横拖」（真人常见）', 600);

    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
