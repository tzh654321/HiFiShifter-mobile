#!/usr/bin/env node
/**
 * #6 真机取证录制器 / 常驻监视器（**只读、不重建**）。
 *
 * 为什么必须录真手指：CDP 的 `Input.dispatchTouchEvent` 走浏览器输入管线，
 * **不触发 Android WebView 的原生手势**（原生长按 / touch-action 滚动接管 /
 * 真实 `pointercancel` 时序），所以 #6 在探针里反复绿、真机反复红。
 *
 * 录制内容：
 *   · pointer down/move/up/cancel（含 `isTrusted`、`pointerType`、**target 元素**、
 *     是否落在浮条/控制点/轨道行上、单指位移）
 *   · touch start/move/end/cancel（手指数）
 *   · `window.__hsTouchModifiers.alt` 的**变化时间序列**（80ms 轮询）
 *   · `hifi:slipPreview` / `hifi:slipCommit` 是否真的到达面板
 *
 * 用法：
 *   # ① 常驻监视（后台跑；持续把轨迹写进 D:\Temp\hs-trace.json）
 *   node scripts/_dbg-twofinger-live.mjs --serial 221deeb --watch
 *   # ② 单次安装
 *   node scripts/_dbg-twofinger-live.mjs --serial 221deeb
 *   # ③ 读回并按 A3 规则回放
 *   node scripts/_dbg-twofinger-live.mjs --serial 221deeb --read
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
let mode = 'install'; // install | read | watch
let out = 'D:\\Temp\\hs-trace.json';
for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--serial') serial = argv[++i];
    else if (argv[i] === '--read') mode = 'read';
    else if (argv[i] === '--watch') mode = 'watch';
    else if (argv[i] === '--out') out = argv[++i];
}

async function attach() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    return cdp;
}

/* ── 录制器（注入页内；v2） ─────────────────────────────────────────────── */
const RECORDER = function () {
    const W = window;
    const V = 2;
    if (W.__hsRecV === V) {
        W.__hsTrace.length = 0;
        return 'reset';
    }
    if (typeof W.__hsRecOff === 'function') {
        try {
            W.__hsRecOff();
        } catch (err) {
            void err;
        }
    }
    const trace = [];
    W.__hsTrace = trace;
    const offs = [];
    const push = (o) => {
        trace.push(o);
        if (trace.length > 1200) trace.shift();
    };
    const inPane = (t) => !!(t && t.closest && t.closest('[data-hs-pane="timeline"]'));
    const altNow = () => (W.__hsTouchModifiers ? W.__hsTouchModifiers.alt === true : null);
    const firstDown = {};
    const rec = (kind, e) => {
        let disp = null;
        if (kind === 'pointermove' && firstDown[e.pointerId]) {
            disp = Math.round(
                Math.hypot(e.clientX - firstDown[e.pointerId].x, e.clientY - firstDown[e.pointerId].y),
            );
        }
        if (kind === 'pointerdown') firstDown[e.pointerId] = { x: e.clientX, y: e.clientY };
        const el = e.target instanceof Element ? e.target : null;
        push({
            t: Math.round(performance.now()),
            kind,
            trust: e.isTrusted === true,
            pt: e.pointerType || null,
            id: e.pointerId == null ? null : e.pointerId,
            x: Math.round(e.clientX),
            y: Math.round(e.clientY),
            pane: inPane(e.target),
            tag: el ? el.tagName : null,
            cls: el ? String(el.className || '').slice(0, 40) : null,
            on: el
                ? [
                      el.closest('[data-hs-clip-actions]') ? 'clip-actions' : '',
                      el.closest('[data-hs-clip-control-points]') ? 'ctrl-points' : '',
                      el.closest('[data-hs-clip-control-point]') ? 'ctrl-point' : '',
                      el.closest('[data-hs-track-row]') ? 'track-row' : '',
                  ]
                      .filter(Boolean)
                      .join('+')
                : null,
            tv: e.touches ? e.touches.length : null,
            disp,
            alt: altNow(),
        });
    };
    for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        const h = (e) => rec(k, e);
        W.addEventListener(k, h, true);
        offs.push(() => W.removeEventListener(k, h, true));
    }
    for (const k of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        const h = (e) => rec(k, e);
        W.addEventListener(k, h, { capture: true, passive: true });
        offs.push(() => W.removeEventListener(k, h, true));
    }
    /* alt 变化时间序列 */
    let lastAlt = null;
    const iv = setInterval(() => {
        const a = altNow();
        if (a !== lastAlt) {
            lastAlt = a;
            push({ t: Math.round(performance.now()), kind: 'alt', alt: a });
        }
    }, 80);
    offs.push(() => clearInterval(iv));
    /* slip 通道是否真的到达面板 */
    for (const k of ['hifi:slipPreview', 'hifi:slipCommit']) {
        const h = (e) => {
            let d = null;
            try {
                d = e.detail ? JSON.parse(JSON.stringify(e.detail)) : null;
            } catch (err) {
                d = String(err);
            }
            push({ t: Math.round(performance.now()), kind: k, alt: altNow(), detail: d });
        };
        W.addEventListener(k, h);
        offs.push(() => W.removeEventListener(k, h));
    }
    W.__hsRecOff = () => offs.forEach((f) => f());
    W.__hsRecV = V;
    return 'installed';
};

if (mode === 'watch') {
    let last = 0;
    process.on('SIGINT', () => process.exit(0));
    for (;;) {
        try {
            const cdp = await attach();
            const st = await cdp.call(RECORDER);
            if (st === 'installed') console.log(`[watch] 录制器已装（v2）→ ${out}`);
            for (;;) {
                await sleep(700);
                const snap = await cdp.call(() => ({
                    v: window.__hsRecV || null,
                    len: (window.__hsTrace || []).length,
                    trace: window.__hsTrace || [],
                    alt: window.__hsTouchModifiers ? window.__hsTouchModifiers.alt === true : null,
                    drag: typeof window.__hsDragDebug === 'function' ? window.__hsDragDebug() : null,
                }));
                if (snap.v !== 2) {
                    console.log('[watch] 页面已刷新 ⇒ 重装录制器');
                    break;
                }
                if (snap.len !== last || snap.alt) {
                    writeFileSync(
                        out,
                        JSON.stringify({ at: Date.now(), len: snap.len, alt: snap.alt, drag: snap.drag, trace: snap.trace }, null, 1),
                    );
                    if (snap.len !== last) {
                        last = snap.len;
                        console.log(`[watch] 轨迹 ${snap.len} 条（alt=${snap.alt}）`);
                    }
                }
            }
            cdp.close();
        } catch (err) {
            console.log('[watch] 重连中：' + String(err && err.message ? err.message : err));
            await sleep(1500);
        }
    }
}

const cdp = await attach();

const install = await cdp.call(RECORDER);

if (mode === 'install') {
    console.log(`录制器：${install}（轨迹 ${await cdp.call(() => (window.__hsTrace || []).length)} 条）`);
    console.log('👉 请在手机上做一次：**双指按在同一个音频块上 → 停约 0.5s → 横拖 → 抬手**');
    console.log(`   做完后执行： node scripts/_dbg-twofinger-live.mjs --serial ${serial} --read`);
    cdp.close();
    process.exit(0);
}

/* ── 读回 + 按 A3 规则回放 ─────────────────────────────────────────────── */
const dump = await cdp.call(function () {
    const tr = window.__hsTrace || [];
    let tapIds = [];
    const start = {};
    let twoMoved = false;
    let litAltAt = null;
    let timerStart = null;
    let timerKilled = null;
    const steps = [];
    for (const r of tr) {
        const tm = r.t;
        if (r.kind === 'alt') {
            steps.push(`ALT ${r.alt ? '点亮' : '熄灭'}`);
            continue;
        }
        if (r.kind === 'hifi:slipPreview' || r.kind === 'hifi:slipCommit') {
            steps.push(`★ ${r.kind} ${JSON.stringify(r.detail)}`);
            continue;
        }
        if (r.alt === true && litAltAt === null) litAltAt = tm;
        if (r.kind === 'pointerdown') {
            const ok = r.trust && r.pt !== 'mouse' && r.pane;
            if (ok) {
                if (tapIds.length === 0) {
                    twoMoved = false;
                    timerStart = null;
                    timerKilled = null;
                }
                tapIds.push(r.id);
                start[r.id] = { x: r.x, y: r.y };
                if (tapIds.length === 2) timerStart = tm;
                steps.push(`↓#${r.id} ok ⇒tap=${tapIds.length}`);
            } else {
                steps.push(
                    `(忽略↓#${r.id} trust=${r.trust} pt=${r.pt} pane=${r.pane} target=${r.tag}.${r.cls}${r.on ? ' on=' + r.on : ''})`,
                );
            }
        } else if (r.kind === 'pointerup' || r.kind === 'pointercancel') {
            const had = tapIds.includes(r.id);
            if (r.trust) tapIds = tapIds.filter((i) => i !== r.id);
            if (had && timerStart !== null && timerKilled === null) {
                timerKilled = { why: r.kind, t: tm, trust: r.trust };
            }
            steps.push(`${r.kind === 'pointerup' ? '↑' : '✖'}#${r.id} trust=${r.trust} ⇒tap=${tapIds.length}`);
        } else if (r.kind === 'pointermove' && !twoMoved && tapIds.length >= 2) {
            const s = start[r.id];
            if (s && r.disp !== null && r.disp > 8) {
                twoMoved = true;
                timerKilled = { why: 'move>8px', t: tm, id: r.id, disp: r.disp };
                steps.push(`~#${r.id} 位移 ${r.disp}px > 8 ⇒ 作废长按候选`);
            }
        } else if (r.kind === 'touchstart' && r.tv >= 2) {
            steps.push(`touchstart ${r.tv}指 (pane=${r.pane} target=${r.tag}.${r.cls})`);
        }
    }
    const counts = {};
    for (const r of tr) counts[r.kind] = (counts[r.kind] || 0) + 1;
    let maxDisp2 = 0;
    let seen = 0;
    for (const r of tr) {
        if (r.kind === 'pointerdown' && r.trust && r.pane) seen += 1;
        if (seen >= 2 && r.kind === 'pointermove' && r.disp != null) maxDisp2 = Math.max(maxDisp2, r.disp);
    }
    const firstCancel = tr.find((r) => (r.kind === 'pointercancel' || r.kind === 'pointerup') && r.trust);
    return {
        n: tr.length,
        counts,
        altEver: tr.some((r) => r.alt === true),
        litAltAt,
        timerStart,
        timerKilled,
        maxDisp2,
        firstTrustedCancel: firstCancel ? { kind: firstCancel.kind, t: firstCancel.t } : null,
        slipEvents: tr.filter((r) => r.kind.startsWith('hifi:')).length,
        steps: steps.slice(0, 90),
        head: tr.slice(0, 50),
    };
});

console.log(`=== 轨迹 ${dump.n} 条 · ${JSON.stringify(dump.counts)} ===`);
console.log(`alt 点亮过 = ${dump.altEver}${dump.litAltAt !== null ? ` (t=${dump.litAltAt})` : ''}`);
console.log(`slip 通道事件到达面板 = ${dump.slipEvents} 条`);
console.log(`两指齐备时刻 = ${dump.timerStart}；被作废 = ${JSON.stringify(dump.timerKilled)}`);
console.log(`两指期间最大单指位移 = ${dump.maxDisp2}px（>8 即作废长按）`);
console.log(`首个 trusted up/cancel = ${JSON.stringify(dump.firstTrustedCancel)}`);
console.log('--- A3 回放 ---');
for (const s of dump.steps) console.log('  ' + s);
console.log('--- 原始前 50 条 ---');
for (const r of dump.head) {
    console.log(
        `  t=${String(r.t).padStart(6)} ${String(r.kind).padEnd(13)} trust=${r.trust === false ? 'n' : 'Y'} pt=${String(r.pt).padEnd(5)} id=${String(r.id).padEnd(3)} ` +
            `(${String(r.x).padStart(4)},${String(r.y).padStart(4)}) pane=${r.pane ? 'Y' : 'n'} tv=${r.tv} disp=${r.disp} alt=${r.alt} ` +
            `target=${r.tag}.${r.cls}${r.on ? ' on=' + r.on : ''}`,
    );
}
cdp.close();
process.exit(0);
