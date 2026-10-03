#!/usr/bin/env node
/**
 * 诊断 A/B：同一段"横拖边缘"手势，分别落在
 *   A. 块**内**右边缘（内核原生命中带）
 *   B. 块**外**控制点圆点（E5 新加的视觉位置）
 * 谁生效、谁的 cursor 变了 —— 用来区分"块外专属问题"与"全局 move 收不到"。
 *
 * 用法：node scripts/_dbg-edge-vs-dot.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9223;

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const c = vp.containerRect;
        const clip = st.clips[0] ?? null;
        const left = clip ? c.left + clip.start_sec * vp.pxPerSec - vp.scrollLeft : 0;
        const right = clip ? left + clip.length_sec * vp.pxPerSec : 0;
        const kern = document.querySelector('[data-hs-timeline-kernel="1"]');
        return {
            left: Math.round(left),
            right: Math.round(right),
            cursor: kern ? kern.style.cursor || '(none)' : '(no kernel)',
            clip: clip && {
                startSec: Number(clip.start_sec.toFixed(4)),
                lengthSec: Number(clip.length_sec.toFixed(4)),
                sourceStartSec: Number(clip.source_start_sec.toFixed(4)),
                fadeInSec: clip.fade_in_sec ?? 0,
                rate: clip.clip_playback_rate ?? clip.playback_rate,
            },
        };
    });
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
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
    console.log('  clip =', JSON.stringify(base.clip), ' left =', base.left, ' right =', base.right);

    /** 从 (x,y) 起手，横拖 dx，期间打印 cursor，结束打印结果。 */
    async function drag(label, x, y, dx) {
        const before = await snap();
        await touch('touchStart', [{ x, y }]);
        await sleep(40);
        const cursors = [];
        const steps = 6;
        for (let i = 1; i <= steps; i += 1) {
            await touch('touchMove', [{ x: x + (dx * i) / steps, y }]);
            await sleep(60);
            const s = await snap();
            cursors.push(s.cursor);
        }
        const during = await snap();
        await touch('touchEnd', []);
        await sleep(700);
        const after = await snap();
        console.log(`── ${label}  起手=(${x},${y}) dx=${dx} ──`);
        console.log('   cursor 序列 =', JSON.stringify(cursors));
        console.log('   before =', JSON.stringify(before.clip));
        console.log('   during =', JSON.stringify(during.clip));
        console.log('   after  =', JSON.stringify(after.clip));
    }

    const y = 133;
    await drag('A 块内右边缘', base.right - 3, y, 50);
    await sleep(300);
    const b2 = await snap();
    console.log('   （A 后）right =', b2.right, 'clip =', JSON.stringify(b2.clip));
    await drag('B 块外控制点圆点', b2.right + 10, y, 50);

    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
