#!/usr/bin/env node
/**
 * 控制点验收（用户 2026-09-30 报的三条）：
 *   「音频块触控点视觉位置与点击位置有偏差」+「会同时触发移动音频块与触控点」
 *   +「似乎无法通过触控实现拉伸与调淡入淡出」
 *
 * 🔑 判定手法：**直接按 DOM 里真正渲染出来的那个圆点**（`[data-hs-clip-control-point="left"]`
 * 的 rect 中心），而不是按"我算出来的边缘坐标"——
 * 用户看到的就是那个圆点，按它必须命中边缘语义。三种语义的区分：
 *   · **移动块**：`start_sec` 变、`source_start_sec` **不变**
 *   · **裁切（边缘）**：`start_sec` 与 `source_start_sec` **一起变**
 *   · **淡入**：`fade_in_sec` 变
 *   · **变速**：`clip_playback_rate` 或 `length_sec` 变（拉伸）
 *
 * 用法：node scripts/_probe-control-point.mjs --serial 221deeb
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: '221deeb', port: 9222, wav: 'D:\\Temp\\hs-tone.wav', hold: 700, dx: 50, dy: 40 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
    }
    return o;
}

/** 页面内：读几何 + 权威工程状态 + 两个圆点的真实 rect。 */
function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const dot = (side) => {
            const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const clips = [...(st.clips || [])].sort((a, b) => a.start_sec - b.start_sec);
        const c0 = clips[0] || null;
        const norm = c0 && {
            id: c0.id,
            trackId: c0.track_id,
            startSec: c0.start_sec,
            lengthSec: c0.length_sec,
            sourceStartSec: c0.source_start_sec,
            sourceEndSec: c0.source_end_sec,
            fadeInSec: c0.fade_in_sec ?? 0,
            fadeOutSec: c0.fade_out_sec ?? 0,
            rate: c0.clip_playback_rate ?? c0.playback_rate,
        };
        const c = vp ? vp.containerRect : null;
        return {
            vp: vp ? { pxPerSec: vp.pxPerSec, scrollLeft: vp.scrollLeft, containerRect: c, rowHeight: vp.rowHeight } : null,
            clips: clips.length,
            clip: norm,
            /** 圆点是"看得见的那一个"——按它的中心点下去。 */
            dotLeft: dot('left'),
            dotRight: dot('right'),
            selected: document.querySelectorAll('[data-hs-clip-selected="1"]').length,
        };
    });
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const tap = async (x, y, hold = 60) => {
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(420);
    };
    const snap = () => cdp.call(inPage);

    /** 清空 + 导入 2s 素材（与其它探针同一手法）。 */
    async function resetAndImport(label) {
        for (let g = 0; g < 6; g++) {
            const cur = await snap();
            if (!cur.clips) break;
            await cdp.call(() => {
                const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
                fire('selectAll');
                fire('delete');
            });
            await sleep(900);
        }
        const b64 = readFileSync(o.wav).toString('base64');
        /* 起点给 0.3s 而不是 0：块左缘要**离开容器左缘**，否则左控制点会被
           `dotPressable` 判定"按不到就不画"（贴左缘时它中心落在轨道头列里），
           「左圆点改起始位置」这条就永远没机会验。 */
        await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), label, b64, 0.3);
        await sleep(1500);
        return snap();
    }
    /** 把块宽缩到视口的一个比例并把视口拉到 0（控制点要落在屏内）。 */
    async function fitTo(ratio) {
        for (let i = 0; i < 20; i++) {
            const s = await snap();
            const vp = s.vp;
            if (vp === null) break;
            const clipPx = s.clip.lengthSec * vp.pxPerSec;
            const target = vp.containerRect.width * ratio;
            if (Math.abs(clipPx - target) <= 3) break;
            const factor = Math.min(8, Math.max(0.125, target / clipPx));
            await cdp.call(
                (f) => window.dispatchEvent(new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } })),
                factor,
            );
            await sleep(220);
        }
        for (let i = 0; i < 30; i++) {
            const s = await snap();
            if (s.vp === null || s.vp.scrollLeft <= 1) break;
            const c = s.vp.containerRect;
            const y = Math.round(c.top + c.height - 120);
            const x0 = Math.round(c.left + 12);
            await touch('touchStart', [{ x: x0, y }]);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [{ x: Math.round(x0 + ((c.width - 24) * k) / 6), y }]);
                await sleep(28);
            }
            await touch('touchEnd', []);
            await sleep(260);
        }
        return snap();
    }
    /** 选中目标块（圆点只在"当前块"上出现）。 */
    async function selectClip() {
        const s = await snap();
        if (s.dotLeft !== null && s.dotRight !== null) return s;
        const vp = s.vp;
        const leftPx = vp.containerRect.left + s.clip.startSec * vp.pxPerSec - vp.scrollLeft;
        const w = s.clip.lengthSec * vp.pxPerSec;
        /* ⚠️ 必须取**块所在轨道**的 DOM 行：原先写死 `querySelector('[data-hs-track-row]')`
           拿的是**第一条**轨道（Main），而导入的块常落在新建轨道上 ⇒ y 整行错开、
           点了个空 ⇒ 永远选不中（实测 `dotLeft=null dotRight=null` 的假象就是这么来的）。 */
        const y = await cdp.call((tid) => {
            const r =
                (tid ? document.querySelector(`[data-hs-track-row="${tid}"]`) : null) ??
                document.querySelector('[data-hs-track-row]');
            return r ? Math.round(r.getBoundingClientRect().top + 45) : 0;
        }, s.clip.trackId);
        await tap(Math.round(leftPx + w / 2), y);
        await sleep(600);
        return snap();
    }

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };
    const d = (a, b, k) => +((b[k] ?? 0) - (a[k] ?? 0)).toFixed(5);
    const isMove = (a, b) => Math.abs(d(a, b, "startSec")) > 1e-4 && Math.abs(d(a, b, "sourceStartSec")) < 1e-4;
    const isTrim = (a, b) => Math.abs(d(a, b, "sourceStartSec")) > 1e-4;

    /* ── CP0 前置：圆点在屏幕上真的渲染出来了吗 ─────────────────────────── */
    await resetAndImport(`hs-cp-${Date.now()}.wav`);
    let s = await fitTo(0.5);
    s = await selectClip();
    check(
        'CP0 前置：选中块后**看得见**可点的控制点圆点（右侧必在；左侧贴边界按不到⇒不画）',
        s.dotRight !== null,
        `dotLeft=${JSON.stringify(s.dotLeft)} dotRight=${JSON.stringify(s.dotRight)} clips=${s.clips}`,
    );
    if (s.dotRight === null) {
        console.log('\n（圆点没渲染出来 ⇒ 后面三条无法判定，先修渲染）');
        cdp.close();
        process.exit(1);
    }

    /** 通用：按"看得见的圆点中心"起手做一次手势。 */
    async function gestureOnDot(stage, dx, dy, side = "right") {
        const g = await snap();
        const dot = side === "right" ? g.dotRight : g.dotLeft;
        if (dot === null) throw new Error(`圆点 ${side} 不在屏幕上`);
        const before = g.clip;
        await touch('touchStart', [{ x: dot.x, y: dot.y }]);
        if (stage) {
            await sleep(o.hold);
            const steps = 4;
            for (let i = 1; i <= steps; i++) {
                await touch('touchMove', [{ x: dot.x, y: dot.y + (dy * i) / steps }]);
                await sleep(45);
            }
            for (let i = 1; i <= steps; i++) {
                await touch('touchMove', [{ x: dot.x + (dx * i) / steps, y: dot.y + dy }]);
                await sleep(45);
            }
        } else {
            const steps = 5;
            for (let i = 1; i <= steps; i++) {
                await touch('touchMove', [{ x: dot.x + (dx * i) / steps, y: dot.y }]);
                await sleep(45);
            }
        }
        await touch('touchEnd', []);
        await sleep(900);
        const after = await snap();
        return { before, after: after.clip, dot };
    }

    /* ── CP1 按**块外圆点**横拖 ⇒ 必须是"边缘/裁切"，而不是"移动块" ──────── */
    {
        const { before, after, dot } = await gestureOnDot(false, o.dx, 0, "right");
        check(
            'CP1 按块外**右**控制点横拖 ⇒ 边缘语义（长度变），**不是**移动块',
            Math.abs(d(before, after, "lengthSec")) > 1e-4 && Math.abs(d(before, after, "startSec")) < 1e-4,
            `圆点=${JSON.stringify(dot)}  Δ=${JSON.stringify({
                startSec: d(before, after, "startSec"),
                lengthSec: d(before, after, "lengthSec"),
                sourceStartSec: d(before, after, "sourceStartSec"),
            })}  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}`,
        );
    }

    /* ── CP1b 按**左**圆点横拖 ⇒ 改的是「起始位置」（`startSec` 变）──────── */
    {
        const { before, after, dot } = await gestureOnDot(false, o.dx, 0, "left");
        check(
            'CP1b 按块外**左**控制点横拖 ⇒ 改动音频块**起始位置**（startSec 变）',
            Math.abs(d(before, after, "startSec")) > 1e-4,
            `圆点=${JSON.stringify(dot)}  Δ=${JSON.stringify({
                startSec: d(before, after, "startSec"),
                lengthSec: d(before, after, "lengthSec"),
            })}`,
        );
    }

    /* ── CP2 圆点长按 + **上划** ⇒ 淡入时长变 ───────────────────────────── */
    {
        await fitTo(0.5);
        const { before, after, dot } = await gestureOnDot(true, -o.dx, -o.dy, "right");
        check(
            'CP2 圆点长按 700ms + 上划 ⇒ 淡入淡出时长变化',
            Math.abs(d(before, after, "fadeInSec")) > 1e-4 || Math.abs(d(before, after, "fadeOutSec")) > 1e-4,
            `圆点=${JSON.stringify(dot)}  ΔfadeIn=${d(before, after, "fadeInSec")}  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}`,
        );
    }

    /* ── CP3 圆点长按 + **下划** ⇒ 变速（拉伸）─────────────────────────── */
    {
        await fitTo(0.5);
        const { before, after, dot } = await gestureOnDot(true, -o.dx, o.dy, "right");
        const rateChanged = Math.abs((after.rate ?? 1) - (before.rate ?? 1)) > 1e-3;
        const lenChanged = Math.abs(d(before, after, "lengthSec")) > 1e-3;
        check(
            'CP3 圆点长按 700ms + 下划 ⇒ 变速拉伸（速率或长度变）',
            rateChanged || lenChanged,
            `圆点=${JSON.stringify(dot)}  rate ${before.rate}→${after.rate}  Δlen=${d(before, after, "lengthSec")}  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}`,
        );
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== 控制点探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
