#!/usr/bin/env node
/**
 * #6 真机取证（内核级真触控）：**双指落点扫描**。
 *
 * 目的：用户口径是「双指操作**永远**等于缩放/平移，双指数据可能根本没传入
 * 分析是否按 Alt 那一步」。而既有探针（`_probe-e41-twofinger-real.mjs`，
 * 两指落在块宽 5% / 15% 处）**总是绿**。⇒ 必须证明落点是不是变量。
 *
 * 本脚本用 `sendevent` 注入真触控（WebView 视作真手指），对一组
 * 「两指落点」逐点跑「双指同块 → 停 0.5s → 横拖」，每点记录：
 *   · A3 是否点亮虚拟 Alt（`window.__hsTouchModifiers.alt`，由录制器 80ms 轮询）
 *   · 到达面板的 `hifi:slipPreview` 条数
 *   · 源窗口 Δ（真 slip 的判据）
 *   · `scrollLeft` 变化（是否退化成了平移）
 *
 * 用法：
 *   node scripts/_dbg-slip-points.mjs --serial 221deeb
 *   node scripts/_dbg-slip-points.mjs --serial 221deeb --points "0.05:0.15,0.3:0.5"
 *   node scripts/_dbg-slip-points.mjs --serial 221deeb --dy 0.2 --points "0.05:0.15,0.05:0.55"
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
const o = {
    serial: '221deeb',
    dpr: 3,
    screen: [1080, 2376],
    raw: [20224, 44480],
    dev: '/dev/input/event6',
    dy: 0.55,
    hold: 600,
    dx: -60,
    steps: 6,
    clip: -1,
    yoff: 40,
    prep: 0.6,
    /** 第二个块的落点（秒）；只有"两指不同块"用例需要。 */
    prep2: null,
    /** 强制清空重导（默认只在没有块时导入）。 */
    forcePrep: false,
    /** 打印整条轨迹（诊断用）。 */
    dump: false,
    /** 跑之前重启应用（复位视口；未保存的工程会丢）。 */
    reset: false,
    /**
     * **两指落指间隔**（秒）：第一指落下 → 间隔 → 第二指落下。
     * 为什么要扫这一维：Android/Chromium 的**原生长按**是从**第一指**落下开始计时的，
     * 所以"先按一指、过半秒再补第二指"是唯一可能触发原生长按（震动 + `contextmenu`
     * + 把 touch 序列 cancel）的时序。默认 0.09s = 真手指两指几乎同时落下。
     */
    gap: 0.09,
    wav: 'D:\\Temp\\hs-tone.wav',
    /* 长按期间的"手指抖动"幅度（CSS px，每 60ms 一次，正负交替）。
       真手指按住时触屏仍以 ~120Hz 上报 MOVE，指尖质心会漂移 ——
       而 A3 的候选作废判据是「**任一指针**位移 > 8px」⇒ 必须扫这一维。
       0 = 不发 MOVE（既有探针口径，永远绿）。 */
    jitter: 0,
    /* 抖动方向：same = 两指同向（手整体轻移）；opp = 两指反向（像在缩放）。 */
    jdir: 'same',
    jperiod: 60,
    /* 手势意图：
       · `hold`  两指按住不动（默认；长按候选应成立 ⇒ 两指同块时进 slip）
       · `scale` 两指反向张合（缩放意图 ⇒ 长按候选应被作废、视口应缩放）
       · `pan`   两指同向移动（平移意图 ⇒ 长按候选应被作废、视口应平移） */
    intent: 'hold',
    /** `scale`/`pan` 的动作幅度（CSS px）。 */
    travel: 200,
    /* 默认点集：都按「块宽」比例给。屏幕宽 360 ⇒ 比例 ≤ ~0.73 才在屏内。 */
    points: '0.05:0.15,0.02:0.30,0.30:0.50,0.45:0.55,0.60:0.70,0.05:0.70,0.10:0.70',
};
for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') o.serial = argv[++i];
    else if (a === '--points') o.points = argv[++i];
    else if (a === '--dy') o.dy = Number(argv[++i]);
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--dx') o.dx = Number(argv[++i]);
    else if (a === '--clip') o.clip = Number(argv[++i]);
    else if (a === '--prep') o.prep = Number(argv[++i]);
    else if (a === '--prep2') o.prep2 = Number(argv[++i]);
    else if (a === '--force-prep') o.forcePrep = true;
    else if (a === '--dump') o.dump = true;
    else if (a === '--reset') o.reset = true;
    else if (a === '--gap') o.gap = Number(argv[++i]);
    else if (a === '--jitter') o.jitter = Number(argv[++i]);
    else if (a === '--jdir') o.jdir = argv[++i];
    else if (a === '--jperiod') o.jperiod = Number(argv[++i]);
    else if (a === '--intent') o.intent = argv[++i];
    else if (a === '--travel') o.travel = Number(argv[++i]);
    else if (a === '--yoff') o.yoff = Number(argv[++i]);
}

const adb = (c, opt) => {
    const r = execSync(`adb -s ${o.serial} ${c}`, opt || { stdio: 'pipe' });
    return r === null ? '' : r.toString();
};
const pid = adb('shell pidof com.arounder.hifishifter').trim();
if (!pid) throw new Error('应用没在跑');
adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
let cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const installRecorder = async () => {
    if ((await cdp.call(() => window.__hsRecV || null)) !== 2) {
        execSync(`node scripts/_dbg-twofinger-live.mjs --serial ${o.serial}`, { stdio: 'ignore' });
    }
};

/* `--reset`：重启应用（未保存的工程会回到空白）⇒ 视口 scrollLeft/pxPerSec 复位。
   为什么需要：上一轮的手势会把视口滚到边界，块随即移出容器/落点，后续用例
   的"两指都落在块上"就不成立了（实测会出现只收到 1 个有效指针的假绿）。 */
if (o.reset) {
    adb('shell am force-stop com.arounder.hifishifter');
    await sleep(1500);
    adb('shell monkey -p com.arounder.hifishifter -c android.intent.category.LAUNCHER 1', { stdio: 'ignore' });
    await sleep(7000);
    const pid2 = adb('shell pidof com.arounder.hifishifter').trim();
    adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid2}`);
    cdp.close();
    cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    o.forcePrep = true;
}
await installRecorder();

/* ── 确保有块。`--force-prep` 强制清空重导（用户口径里的"两指不同块"用例需要两块）── */
const clipCount = await cdp.call(() =>
    window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => (s.clips || []).length),
);
const importAt = async (at) => {
    await cdp.call(async (b64, at2) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '停止');
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 200));
        return window.__hsImportAudioBase64('2f-points.wav', b64, at2);
    }, readFileSync(o.wav).toString('base64'), at);
    await sleep(1800);
};
if (o.forcePrep && clipCount > 0) {
    for (let i = 0; i < 5; i++) {
        const n = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => (s.clips || []).length),
        );
        if (n === 0) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
        await sleep(700);
    }
}
if ((clipCount === 0 || o.forcePrep) && o.prep !== null) {
    await importAt(o.prep);
    /* 第二个块（只给"两指不同块"用例用）：落在 `prep2` 秒。 */
    if (o.prep2 !== null) await importAt(o.prep2);
}

const clipGeoOf = (i) =>
    cdp.call((idx) =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const vp = window.__hsViewport();
            const c = vp.containerRect;
            const list = s.clips || [];
            const k = idx < 0 ? list[list.length + idx] : list[idx];
            if (!k) return null;
            const rowEl = document.querySelector(`[data-hs-track-row="${k.track_id}"]`);
            const rr = rowEl ? rowEl.getBoundingClientRect() : null;
            const left = c.left + k.start_sec * vp.pxPerSec - vp.scrollLeft;
            const width = Math.max(24, k.length_sec * vp.pxPerSec);
            const pane = document.querySelector('[data-hs-pane="timeline"]');
            const pr = pane ? pane.getBoundingClientRect() : null;
            return {
                clipId: k.id,
                left: Math.round(left),
                width: Math.round(width),
                rowTop: rr ? Math.round(rr.top) : null,
                rowH: rr ? Math.round(rr.height) : null,
                cLeft: Math.round(c.left),
                pane: pr
                    ? { l: Math.round(pr.left), t: Math.round(pr.top), r: Math.round(pr.right), b: Math.round(pr.bottom) }
                    : null,
                dots: document.querySelectorAll('[data-hs-clip-control-point]').length,
            };
        }),
        i,
    );

const geo = await clipGeoOf(o.clip < 0 ? -1 : o.clip);
if (!geo) throw new Error('没有块可测');
/* 「两指落在**不同**块上」用例需要第二个块（取倒数第二块）。 */
const prevGeo = o.intent === 'twoClips' ? await clipGeoOf(-2) : null;
const y = geo.rowTop !== null ? geo.rowTop + Math.round(geo.rowH * o.dy) : 120;
console.log(
    `块 [${geo.left},+${geo.width}] 容器左=${geo.cLeft} pane=${JSON.stringify(geo.pane)} ` +
        `控制点=${geo.dots} 行 top=${geo.rowTop} h=${geo.rowH} 落指 y=${y}`,
);
if (o.intent === 'twoClips') {
    console.log(
        prevGeo
            ? `第二块（用于"两指不同块"）[${prevGeo.left},+${prevGeo.width}] 行 top=${prevGeo.rowTop}`
            : `⚠️ 只有一块 —— 请加 --force-prep --prep2 3.0 造出两块`,
    );
}

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

function build(p1, p2) {
    const [r1x, r1y] = toRaw(p1[0], p1[1]);
    const [r2x, r2y] = toRaw(p2[0], p2[1]);
    const rawDx = Math.round((o.dx * o.dpr * o.raw[0]) / o.screen[0]);
    const L = [];
    const e = (t, c, v) => L.push(`sendevent ${D} ${t} ${c} ${v}`);
    const syn = () => e(0, 0, 0);
    e(3, 47, 0); e(3, 57, -1); syn(); L.push('sleep 0.05');
    e(1, 325, 1);
    e(3, 47, 0); e(3, 57, 100); e(3, 55, 0); e(3, 53, r1x); e(3, 54, r1y); e(3, 48, 20);
    e(1, 330, 1); syn(); L.push(`sleep ${o.gap.toFixed(3)}`);
    e(3, 47, 1); e(3, 57, 101); e(3, 55, 0); e(3, 53, r2x); e(3, 54, r2y); e(3, 48, 20);
    syn();
    if (o.intent === 'scale' || o.intent === 'pan') {
        /* 缩放/平移意图：两指**落齐后立刻**动作（都在长按 500ms 之内）。
           缩放 = 反向张合（间距变、中点不变）；平移 = 同向移动（中点变、间距不变）。
           两者都应作废长按候选 ⇒ alt 不点亮、视口照常缩放/平移。 */
        /* 🔴 步数与节奏：`sendevent` 是**独立进程**，每条要 fork/exec（实测每步
           5 条 ≈ 60~90ms）⇒ 步数越多，500ms 长按阈值内走完的比例越小，
           "到点时位移够不够超过死区"就变成随机 ⇒ 用例会 flaky（实测 20 步 × 25ms
           稳定误点亮 alt，10 步 × 50ms 时红时绿）。改成**少步 + 大步长**：
           6 步 × 33px，真实耗时 ≈ 400ms ⇒ 到点时位移已充分 ⇒ 判据稳定生效。 */
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const dRaw = Math.round((o.travel * t * o.dpr * o.raw[0]) / o.screen[0]);
            const d = o.intent === 'scale' ? Math.round(dRaw / 2) : dRaw;
            const a = o.intent === 'scale' ? r1x - d : r1x + d;
            const b = o.intent === 'scale' ? r2x + d : r2x + d;
            e(3, 47, 0); e(3, 53, a); e(3, 54, r1y);
            e(3, 47, 1); e(3, 53, b); e(3, 54, r2y);
            syn();
            L.push('sleep 0.05');
        }
        /* 动作 → 抬指（不再横拖：本用例的语义就是"用户想做缩放/平移"）。 */
        e(3, 47, 1); e(3, 57, -1); syn(); L.push('sleep 0.04');
        e(3, 47, 0); e(3, 57, -1); e(1, 330, 0); e(1, 325, 0); syn();
        return L;
    }
    if (o.jitter > 0) {
        /* 长按期间的手指抖动：每 `jperiod` ms 一次、正负交替，幅度 `jitter` CSS px。
           CSS px → raw：x 与 y 的换算比例不同（屏幕 1080×2376，raw 20224×44480）。 */
        const jx = Math.round((o.jitter * o.dpr * o.raw[0]) / o.screen[0]);
        const jy = Math.round((o.jitter * o.dpr * o.raw[1]) / o.screen[1]);
        const n = Math.max(1, Math.floor(o.hold / o.jperiod));
        for (let i = 0; i < n; i++) {
            const s = i % 2 === 0 ? 1 : -1;
            const d1x = jx * s;
            const d1y = jy * s;
            const d2 = o.jdir === 'opp' ? -s : s;
            e(3, 47, 0); e(3, 53, r1x + d1x); e(3, 54, r1y + d1y);
            e(3, 47, 1); e(3, 53, r2x + jx * d2); e(3, 54, r2y + jy * d2);
            syn();
            L.push(`sleep ${(o.jperiod / 1000).toFixed(3)}`);
        }
    } else {
        L.push(`sleep ${(o.hold / 1000).toFixed(3)}`);
    }
    for (let i = 1; i <= o.steps; i++) {
        const t = i / o.steps;
        e(3, 47, 0); e(3, 53, Math.round(r1x + rawDx * t)); e(3, 54, r1y);
        e(3, 47, 1); e(3, 53, Math.round(r2x + rawDx * t)); e(3, 54, r2y);
        syn();
        L.push('sleep 0.05');
    }
    e(3, 47, 1); e(3, 57, -1); syn(); L.push('sleep 0.04');
    e(3, 47, 0); e(3, 57, -1); e(1, 330, 0); e(1, 325, 0); syn();
    return L;
}

const readAll = () =>
    cdp.call((id) =>
        Promise.all([
            window.__TAURI_INTERNALS__.invoke('get_timeline_state'),
            Promise.resolve(window.__hsViewport()),
            Promise.resolve(window.__hsTrace || []),
        ]).then(([s, vp, tr]) => {
            const k = (s.clips || []).find((x) => x.id === id) || (s.clips || [])[s.clips.length - 1];
            return {
                after: k ? { s: k.source_start_sec, e: k.source_end_sec } : null,
                scrollLeft: Math.round(vp.scrollLeft),
                scrollTop: Math.round(vp.scrollTop ?? 0),
                pxPerSec: +Number(vp.pxPerSec).toFixed(4),
                rowHeight: +Number(vp.rowHeight ?? 0).toFixed(3),
                trace: tr,
            };
        }),
        geo.clipId,
    );

const rows = [];
for (const [i, spec] of o.points.split(',').entries()) {
    const [f1, f2] = spec.split(':').map(Number);
    /* `twoClips`：指1 落在**倒数第二块**中部、指2 落在**最后一块**中部
       —— 用户口径「双指要落在同一个音频块上才会触发调偏移，其他情况（含两块）
       双指仍会被解析为平移/缩放」。 */
    const p1 =
        o.intent === 'twoClips' && prevGeo
            ? [prevGeo.left + Math.round(prevGeo.width * 0.5), prevGeo.rowTop + Math.round(prevGeo.rowH * o.dy)]
            : [geo.left + Math.round(geo.width * f1), y];
    const p2 =
        o.intent === 'twoClips' && prevGeo
            ? [geo.left + Math.round(geo.width * 0.5), y]
            : [geo.left + Math.round(geo.width * f2), y];
    const inPane = (p) =>
        geo.pane !== null && p[0] >= geo.pane.l && p[0] <= geo.pane.r && p[1] >= geo.pane.t && p[1] <= geo.pane.b;
    await cdp.call(() => {
        window.__hsTrace.length = 0;
        return true;
    });
    const before = await cdp.call((id) =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const k = (s.clips || []).find((x) => x.id === id) || (s.clips || [])[s.clips.length - 1];
            return k ? { s: k.source_start_sec, e: k.source_end_sec } : null;
        }),
        geo.clipId,
    );
    const scroll0 = (await readAll()).scrollLeft;
    const rate0 = (await readAll()).pxPerSec;
    const row0 = (await readAll()).rowHeight;
    const top0 = (await readAll()).scrollTop;
    inject(build(p1, p2), `hs-pt${i}`);
    await sleep(1400);
    const snap = await readAll();
    const tr = snap.trace;
    const altEver = tr.some((r) => r.alt === true);
    const slipEvents = tr.filter((r) => r.kind === 'hifi:slipPreview' || r.kind === 'hifi:slipCommit').length;
    /* ⚠️ 统计口径：A3 的落点判定用的是**几何**（落在 `[data-hs-pane="timeline"]` 的
       rect 内），而录制器的 `pane` 标志是**DOM 祖先**判定 —— 两者对"轨道头列那一段"
       结论不同。所以这里同时报出两个数：`信任 down 总数`（= A3 会看到几个指针的
       上界）与 `DOM 在 pane 内数`。 */
    const downs = tr.filter((r) => r.kind === 'pointerdown' && r.trust).length;
    const accepted = tr.filter((r) => r.kind === 'pointerdown' && r.trust && r.pane).length;
    const dS = before && snap.after ? +(snap.after.s - before.s).toFixed(4) : null;
    const dE = before && snap.after ? +(snap.after.e - before.e).toFixed(4) : null;
    const slip = dS !== null && (Math.abs(dS) > 1e-3 || Math.abs(dE) > 1e-3);
    const r = {
        spec,
        p1,
        p2,
        inPane: `${inPane(p1) ? 'Y' : 'n'}${inPane(p2) ? 'Y' : 'n'}`,
        accepted,
        downs,
        altEver,
        slipEvents,
        dS,
        dE,
        slip,
        scroll: `${scroll0}→${snap.scrollLeft}`,
        rate: `${rate0}→${snap.pxPerSec}`,
        row: `${row0}→${snap.rowHeight}`,
        top: `${top0}→${snap.scrollTop}`,
        /* 双指手势"仍然活着"的证据：视口至少有一个自由度真的动了。 */
        viewportMoved:
            snap.pxPerSec !== rate0 || snap.rowHeight !== row0 || snap.scrollLeft !== scroll0 || snap.scrollTop !== top0,
    };
    rows.push(r);
    console.log(
        `[${String(i).padStart(2)}] ${spec.padEnd(11)} 指1=(${String(p1[0]).padStart(3)},${y}) 指2=(${String(p2[0]).padStart(3)},${y}) ` +
            `pane=${r.inPane} down=${downs}(DOM内${accepted}) alt=${altEver ? 'Y' : 'n'} slip事件=${String(slipEvents).padStart(2)} ` +
            `Δsrc=${JSON.stringify({ s: dS, e: dE })} ${slip ? 'SLIP✅' : '未slip❌'} scroll=${r.scroll} pxPerSec=${r.rate} ` +
            `rowH=${r.row} scrollTop=${r.top} 视口动=${r.viewportMoved ? 'Y' : 'n'}`,
    );
    if (!altEver || o.dump) {
        const allDowns = tr.filter((r2) => r2.kind === 'pointerdown');
        for (const d of allDowns) {
            console.log(
                `        ↓#${d.id} trust=${d.trust ? 'Y' : 'n'} pt=${d.pt} (${d.x},${d.y}) pane=${d.pane ? 'Y' : 'n'} ` +
                    `on=${d.on || '-'} tag=${d.tag}.${d.cls}`,
            );
        }
        const cancels = tr.filter((r2) => r2.kind === 'pointercancel' || r2.kind === 'pointerup');
        for (const c of cancels) console.log(`        ${c.kind}#${c.id} trust=${c.trust ? 'Y' : 'n'}`);
    }
    if (o.dump) {
        for (const t of tr) {
            console.log(
                `        t=${String(t.t).padStart(6)} ${String(t.kind).padEnd(13)} id=${String(t.id).padEnd(4)} ` +
                    `(${String(t.x).padStart(4)},${String(t.y).padStart(4)}) alt=${t.alt} disp=${t.disp} tv=${t.tv}`,
            );
        }
    }
}

console.log('\n=== 落点扫描汇总（内核级真触控）===');
for (const r of rows) {
    console.log(
        `${r.spec.padEnd(11)} 指1=${String(r.p1[0]).padStart(3)} 指2=${String(r.p2[0]).padStart(3)} pane=${r.inPane} ` +
            `down=${r.downs}(DOM内${r.accepted}) alt=${r.altEver ? 'Y' : 'n'} slip事件=${String(r.slipEvents).padStart(2)} ` +
            `${r.slip ? 'SLIP✅' : '未slip❌'} scroll=${r.scroll} pxPerSec=${r.rate} rowH=${r.row} 视口动=${r.viewportMoved ? 'Y' : 'n'}`,
    );
}
cdp.close();
process.exit(0);
