#!/usr/bin/env node
/**
 * #6 真机判据：**内核级真多点触控**（`sendevent`）双指长按块 + 横拖。
 *
 * 为什么必须用内核注入：CDP 的 `Input.dispatchTouchEvent` 走浏览器输入管线，
 * **不触发 Android WebView 的原生手势**（原生长按 / touch-action 接管 /
 * 真实 `pointercancel` 时序）⇒ CDP 探针永远绿、真机永远红。
 * `sendevent` 注入的是内核事件，WebView 视作真手指。
 *
 * 用法：
 *   # 基线：不选中块，双指长按块 + 左拖（应 ⇒ slip）
 *   node scripts/_probe-e41-twofinger-real.mjs --serial 221deeb --prep 0.6
 *   # 对照：**先选中块**（浮条/控制点出现）再双指长按块
 *   node scripts/_probe-e41-twofinger-real.mjs --serial 221deeb --prep 0.6 --select
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
const o = {
    serial: '221deeb',
    dpr: 3,
    screen: [1080, 2376],
    raw: [20224, 44480],
    dev: '/dev/input/event6',
    fx: 0.05,
    sx: 0.15,
    dy: 0.55,
    hold: 600,
    dx: -60,
    steps: 6,
    clip: -1,
    /* WebView 视口顶不落在屏幕原点：原生 `applySafeAreaInsets()` 给 contentView 垫了
       状态栏高度 ⇒ 实测 CSS y 比"屏幕 y/dpr"**小 40**（请求 189 → 落到 149）。 */
    yoff: 40,
    prep: null,
    select: false,
    wav: 'D:\\Temp\\hs-tone.wav',
};
for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') o.serial = argv[++i];
    else if (a === '--fx') o.fx = Number(argv[++i]);
    else if (a === '--sx') o.sx = Number(argv[++i]);
    else if (a === '--dy') o.dy = Number(argv[++i]);
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--dx') o.dx = Number(argv[++i]);
    else if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--clip') o.clip = Number(argv[++i]);
    else if (a === '--yoff') o.yoff = Number(argv[++i]);
    else if (a === '--prep') o.prep = Number(argv[++i]);
    else if (a === '--select') o.select = true;
}

const adb = (c, opt) => execSync(`adb -s ${o.serial} ${c}`, opt || { stdio: 'pipe' }).toString();
const pid = adb('shell pidof com.arounder.hifishifter').trim();
if (!pid) throw new Error('应用没在跑');
adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

if ((await cdp.call(() => window.__hsRecV || null)) !== 2) {
    execSync(`node scripts/_dbg-twofinger-live.mjs --serial ${o.serial}`, { stdio: 'ignore' });
}
const clearTrace = () => cdp.call(() => { window.__hsTrace.length = 0; return true; });

const D = o.dev;
const toRaw = (cx, cy) => [
    Math.round(((cx * o.dpr) / o.screen[0]) * o.raw[0]),
    Math.round((((cy + o.yoff) * o.dpr) / o.screen[1]) * o.raw[1]),
];
const inject = (lines, name) => {
    writeFileSync(`D:\\Temp\\${name}.sh`, '#!/system/bin/sh\n' + lines.join('\n') + '\n');
    adb(`push D:/Temp/${name}.sh /data/local/tmp/${name}.sh`);
    adb(`shell su -c "sh /data/local/tmp/${name}.sh"`, { stdio: 'pipe' });
};
const tapScript = (cx, cy) => {
    const [rx, ry] = toRaw(cx, cy);
    const e = (t, c, v) => `sendevent ${D} ${t} ${c} ${v}`;
    return [
        e(3, 47, 0), e(3, 57, -1), e(0, 0, 0), 'sleep 0.05',
        e(1, 325, 1), e(3, 47, 0), e(3, 57, 300), e(3, 55, 0),
        e(3, 53, rx), e(3, 54, ry), e(3, 48, 20), e(1, 330, 1), e(0, 0, 0),
        'sleep 0.10',
        e(3, 47, 0), e(3, 57, -1), e(1, 330, 0), e(1, 325, 0), e(0, 0, 0),
    ];
};

/* ── 可选：清空 + 导入一个宽块（便于把手指放在"完全可见"的部分） ────────── */
if (o.prep !== null) {
    for (let i = 0; i < 5; i++) {
        const n = await cdp.call(() => window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => s.clips.length));
        if (n === 0) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
        await sleep(700);
    }
    await cdp.call(async (b64, at) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '停止');
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 200));
        return window.__hsImportAudioBase64('2f-real.wav', b64, at);
    }, (await import('node:fs')).readFileSync(o.wav).toString('base64'), o.prep);
    await sleep(1600);
}

const geoOf = (idx) =>
    cdp.call((i) => {
        return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const vp = window.__hsViewport();
            const c = vp.containerRect;
            const list = s.clips || [];
            const k = i < 0 ? list[list.length - 1] : list[i];
            if (!k) return null;
            const rowEl = document.querySelector(`[data-hs-track-row="${k.track_id}"]`);
            const rr = rowEl ? rowEl.getBoundingClientRect() : null;
            const left = c.left + k.start_sec * vp.pxPerSec - vp.scrollLeft;
            const width = Math.max(24, k.length_sec * vp.pxPerSec);
            return {
                clipId: k.id,
                left: Math.round(left),
                right: Math.round(left + width),
                width: Math.round(width),
                rowTop: rr ? Math.round(rr.top) : null,
                rowH: rr ? Math.round(rr.height) : null,
                cTop: Math.round(c.top),
                cLeft: Math.round(c.left),
                scrollLeft: Math.round(vp.scrollLeft),
            };
        });
    }, idx);

const geo = await geoOf(o.clip);
if (!geo) throw new Error('没有块可测（用 --prep 0.6 导入一个）');
const y = geo.rowTop !== null ? geo.rowTop + Math.round(geo.rowH * o.dy) : geo.cTop + 40;
const p1 = [geo.left + Math.round(geo.width * o.fx), y];
const p2 = [geo.left + Math.round(geo.width * o.sx), y];
console.log(`块 [${geo.left},${geo.right}] w=${geo.width} row=[${geo.rowTop},+${geo.rowH}] 容器左=${geo.cLeft}`);
console.log(`指1=(${p1})  指2=(${p2})   （两指都在块内=${p1[0] >= geo.left && p2[0] <= geo.right}；在容器内=${p1[0] >= geo.cLeft}）`);

/* ── 可选：先选中块（造出浮条/控制点） ─────────────────────────────────── */
if (o.select) {
    inject(tapScript(Math.round((p1[0] + p2[0]) / 2), y), 'hs-sel');
    await sleep(900);
    const ov = await cdp.call(() => ({
        actions: !!document.querySelector('[data-hs-clip-actions]'),
        dots: document.querySelectorAll('[data-hs-clip-control-point]').length,
        sel: (window.__hsDragDebug ? window.__hsDragDebug().selectedClipId : null),
    }));
    console.log(`选中后：clip-actions=${ov.actions} 控制点=${ov.dots} 选中块=${ov.sel}`);
}

/* ── 双指长按 + 横拖（内核注入） ───────────────────────────────────────── */
const [r1x, r1y] = toRaw(p1[0], p1[1]);
const [r2x, r2y] = toRaw(p2[0], p2[1]);
const rawDx = Math.round((o.dx * o.dpr * o.raw[0]) / o.screen[0]);
const L = [];
const e = (t, c, v) => L.push(`sendevent ${D} ${t} ${c} ${v}`);
const syn = () => e(0, 0, 0);
e(3, 47, 0); e(3, 57, -1); syn(); L.push('sleep 0.05');
e(1, 325, 1);
e(3, 47, 0); e(3, 57, 100); e(3, 55, 0); e(3, 53, r1x); e(3, 54, r1y); e(3, 48, 20);
e(1, 330, 1); syn();
L.push('sleep 0.09');
e(3, 47, 1); e(3, 57, 101); e(3, 55, 0); e(3, 53, r2x); e(3, 54, r2y); e(3, 48, 20);
syn();
L.push(`sleep ${(o.hold / 1000).toFixed(3)}`);
for (let i = 1; i <= o.steps; i++) {
    const t = i / o.steps;
    e(3, 47, 0); e(3, 53, Math.round(r1x + rawDx * t)); e(3, 54, r1y);
    e(3, 47, 1); e(3, 53, Math.round(r2x + rawDx * t)); e(3, 54, r2y);
    syn();
    L.push('sleep 0.05');
}
e(3, 47, 1); e(3, 57, -1); syn(); L.push('sleep 0.04');
e(3, 47, 0); e(3, 57, -1); e(1, 330, 0); e(1, 325, 0); syn();

const stateOf = () =>
    cdp.call((id) =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const k = (s.clips || []).find((x) => x.id === id) || (s.clips || [])[s.clips.length - 1];
            return k ? { s: k.source_start_sec, e: k.source_end_sec, start: k.start_sec, len: k.length_sec } : null;
        }),
    geo.clipId);
await clearTrace();
const before = await stateOf();
const scrollBefore = geo.scrollLeft;
inject(L, 'hs-2f');
await sleep(1500);
const after = await stateOf();
const scrollAfter = await cdp.call(() => Math.round(window.__hsViewport().scrollLeft));
const trace = await cdp.call(() => (window.__hsTrace || []).slice());

const altEver = trace.some((r) => r.alt === true);
const slipEvents = trace.filter((r) => r.kind === 'hifi:slipPreview' || r.kind === 'hifi:slipCommit');
const downs = trace.filter((r) => r.kind === 'pointerdown');
const cancels = trace.filter((r) => (r.kind === 'pointercancel' || r.kind === 'pointerup') && r.trust);
const ignored = trace.filter((r) => r.kind === 'pointerdown' && !(r.trust && r.pt !== 'mouse' && r.pane));
const maxDisp = trace.reduce((m, r) => (r.kind === 'pointermove' && r.disp != null ? Math.max(m, r.disp) : m), 0);
const dS = after && before ? +(after.s - before.s).toFixed(4) : null;
const dE = after && before ? +(after.e - before.e).toFixed(4) : null;
const slip = dS !== null && (Math.abs(dS) > 1e-3 || Math.abs(dE) > 1e-3);

console.log(`\n=== 轨迹 ${trace.length}；pointerdown ${downs.length}（被忽略 ${ignored.length}）；trusted up/cancel ${cancels.length}；最大单指位移 ${maxDisp}px`);
console.log(`alt 点亮 = ${altEver}；slip 通道事件 = ${slipEvents.length}`);
console.log(`源窗口 Δ=${JSON.stringify({ s: dS, e: dE })} ⇒ ${slip ? 'SLIP ✅' : '未 slip'}`);
console.log(`scrollLeft ${scrollBefore} → ${scrollAfter}（变 = 平移）`);
for (const r of ignored) console.log(`  ⚠️ 被 A3 忽略的 pointerdown：target=${r.tag}.${r.cls}${r.on ? ' on=' + r.on : ''} pane=${r.pane}`);
console.log('--- 轨迹 ---');
for (const r of trace.slice(0, 40)) {
    if (r.kind.startsWith('hifi:')) { console.log(`  ★ ${r.kind} Δ=${r.detail && r.detail.deltaSec}`); continue; }
    console.log(`  t=${String(r.t).padStart(6)} ${String(r.kind).padEnd(13)} trust=${r.trust === false ? 'n' : 'Y'} id=${String(r.id).padEnd(3)} (${String(r.x).padStart(4)},${String(r.y).padStart(4)}) pane=${r.pane ? 'Y' : 'n'} disp=${r.disp} alt=${r.alt} ${r.tag || ''}${r.on ? ' on=' + r.on : ''}`);
}
cdp.close();
process.exit(0);
