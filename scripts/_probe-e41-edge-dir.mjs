#!/usr/bin/env node
/**
 * E41-3b 验收：**控制点"迅速下划 = 拉伸"、而"迅速横拖 = 裁剪"**。
 *
 * 用户口径（2026-10-04 手测）：「**按控制点迅速下划，图标会变、但模式仍是裁剪而非拉伸**」，
 * 并给了修法：**把长按控制点的时间阈值改成 0**。
 *
 * 根因：内核 `TOUCH_EDGE_HOLD_MS`（原 200）内位移超阈值 ⇒ **作废长按候选、降级成普通裁剪**；
 * 而浮层那个图标只看 `dy`、**没有时间门控** ⇒ 图标显示"变速"、实际却在裁剪。
 * 修：`TOUCH_EDGE_HOLD_MS = 0`（纵向定型 `EDGE_KIND_LOCK_PX=8` 才是防误判主力）。
 *
 * 判据（区分拉伸 / 裁剪看**改了什么**）：
 *   · **拉伸**（Alt 拖边缘）= 对侧边缘固定、改**播放速率**，源窗口**不变**
 *   · **裁剪**（普通拖边缘）= 改长度 + **源窗口**（sourceStart/SourceEnd）**变**、速率不变
 *
 *   E1 立即下划（无等待）⇒ 必须是**拉伸**（rate 变、源窗口不变）
 *   E2 立即横拖（无等待）⇒ 必须是**裁剪**（源窗口变、rate 不变）—— 防止"改了阈值把裁剪弄丢"
 *
 * 用法：node scripts/_probe-e41-edge-dir.mjs [--serial 221deeb] [--at 1.0]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
let wav = 'D:\\Temp\\hs-tone.wav';
let insertAt = 1.0;
for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--serial') serial = argv[++i];
    else if (argv[i] === '--wav') wav = argv[++i];
    else if (argv[i] === '--at') insertAt = Number(argv[++i]);
}

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
if (!pid) throw new Error('应用没在跑');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {}

const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({
            id: p.id ?? 0,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });
const tap = async (x, y, hold = 60) => {
    await touch('touchStart', [{ id: 0, x, y }]);
    await sleep(hold);
    await touch('touchEnd', []);
    await sleep(360);
};

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

await cdp.call(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '停止');
    if (b) b.click();
});
await sleep(500);

async function clearAll() {
    for (let i = 0; i < 6; i++) {
        const n = await cdp.call(() => window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => s.clips.length));
        if (n === 0) return;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
        await sleep(850);
    }
}

/** 读目标块（含 rate / 源窗口）。 */
const readClip = () =>
    cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const k = (s.clips || [])[0];
            if (!k) return null;
            return {
                id: k.id,
                startSec: k.start_sec,
                lengthSec: k.length_sec,
                sourceStartSec: k.source_start_sec,
                sourceEndSec: k.source_end_sec,
                rate: k.clip_playback_rate ?? k.playback_rate,
                fadeInSec: k.fade_in_sec ?? k.fadeInSec,
                fadeOutSec: k.fade_out_sec ?? k.fadeOutSec,
            };
        }),
    );

/** 建场景 + 找到可用圆点。 */
async function scene(tag) {
    await clearAll();
    /* ⚠️ 文件名必须在**页面外**拼好（`cdp.call` 的回调会被序列化进页面执行，
       闭包变量取不到 —— 第一版就踩了 `tag is not defined`）。 */
    const clipName = `edge-${tag}.wav`;
    await cdp.call(
        (n, b, at) => window.__hsImportAudioBase64(n, b, at),
        clipName,
        readFileSync(wav).toString('base64'),
        insertAt,
    );
    await sleep(1500);
    /* 点一下块选中（浮条/圆点才会出现）。 */
    const p = await cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const vp = window.__hsViewport();
            const c = vp.containerRect;
            const k = (s.clips || [])[0];
            if (!k) return null;
            const rowEl = document.querySelector(`[data-hs-track-row="${k.track_id}"]`);
            const rr = rowEl ? rowEl.getBoundingClientRect() : null;
            const left = c.left + k.start_sec * vp.pxPerSec - vp.scrollLeft;
            const right = left + k.length_sec * vp.pxPerSec;
            return {
                tapX: Math.round((left + right) / 2),
                tapY: Math.round((rr ? rr.top + rr.height : c.top + 40) * 0.6),
                clipLeft: Math.round(left),
                clipRight: Math.round(right),
            };
        }),
    );
    if (!p) throw new Error('没建出块');
    await tap(p.tapX, p.tapY);
    const dot = await cdp.call(() => {
        const el = document.querySelector('[data-hs-clip-control-point="left"]') ?? document.querySelector('[data-hs-clip-control-point]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            side: el.getAttribute('data-hs-clip-control-point'),
            cx: Math.round(r.left + r.width / 2),
            cy: Math.round(r.top + r.height / 2),
        };
    });
    return { dot, p };
}

const before = await readClip();

/* ── E1 立即下划（**不等待**）⇒ 必须拉伸 ──────────────────────────────── */
{
    const s = await scene('e1');
    if (!s.dot) {
        check('E1 立即下划 ⇒ 拉伸（rate 变、源窗口不变）', false, '没有可用圆点（先修渲染）');
    } else {
        const b = await readClip();
        /* 关键：**不 sleep**，按下就直接下划（模拟"迅速下划"）。 */
        await touch('touchStart', [{ id: 0, x: s.dot.cx, y: s.dot.cy }]);
        for (let i = 1; i <= 4; i += 1) {
            await touch('touchMove', [{ id: 0, x: s.dot.cx, y: s.dot.cy + (40 * i) / 4 }]);
            await sleep(40);
        }
        for (let i = 1; i <= 4; i += 1) {
            await touch('touchMove', [{ id: 0, x: s.dot.cx + (40 * i) / 4, y: s.dot.cy + 40 }]);
            await sleep(40);
        }
        await touch('touchEnd', []);
        await sleep(1400);
        const a = await readClip();
        const rateChanged = a && b && Math.abs(Number(a.rate) - Number(b.rate)) > 1e-3;
        const sourceKept =
            a && b && Math.abs(Number(a.sourceStartSec) - Number(b.sourceStartSec)) < 1e-3 &&
            Math.abs(Number(a.sourceEndSec) - Number(b.sourceEndSec)) < 1e-3;
        check(
            'E1 立即下划（无等待）⇒ 拉伸：**rate 变**且**源窗口不变**',
            Boolean(rateChanged && sourceKept),
            `圆点=${JSON.stringify(s.dot)}  rate ${b?.rate} → ${a?.rate}（变了=${rateChanged}）  源窗口 ${b?.sourceStartSec}/${b?.sourceEndSec} → ${a?.sourceStartSec}/${a?.sourceEndSec}（不变=${sourceKept}）`,
        );
    }
}

/* ── E2 立即横拖（**不等待**）⇒ 必须裁剪 ─────────────────────────────── */
{
    const s = await scene('e2');
    if (!s.dot) {
        check('E2 立即横拖 ⇒ 裁剪（源窗口变、rate 不变）', false, '没有可用圆点');
    } else {
        const b = await readClip();
        await touch('touchStart', [{ id: 0, x: s.dot.cx, y: s.dot.cy }]);
        for (let i = 1; i <= 5; i += 1) {
            await touch('touchMove', [{ id: 0, x: s.dot.cx + (50 * i) / 5, y: s.dot.cy }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(1400);
        const a = await readClip();
        const sourceChanged =
            a && b &&
            (Math.abs(Number(a.sourceStartSec) - Number(b.sourceStartSec)) > 1e-3 ||
                Math.abs(Number(a.sourceEndSec) - Number(b.sourceEndSec)) > 1e-3 ||
                Math.abs(Number(a.lengthSec) - Number(b.lengthSec)) > 1e-3);
        const rateKept = a && b && Math.abs(Number(a.rate) - Number(b.rate)) < 1e-3;
        check(
            'E2 立即横拖（无等待）⇒ 裁剪：**几何/源窗口变**且**rate 不变**',
            Boolean(sourceChanged && rateKept),
            `圆点=${JSON.stringify(s.dot)}  rate ${b?.rate} → ${a?.rate}（不变=${rateKept}）  len ${b?.lengthSec} → ${a?.lengthSec}  源 ${b?.sourceStartSec}/${b?.sourceEndSec} → ${a?.sourceStartSec}/${a?.sourceEndSec}`,
        );
    }
}

/* ── E3 立即上划（**不等待**）⇒ 必须淡变（先补一刀：确认"上"这条路径本身是活的）── */
{
    const s = await scene('e3');
    if (!s.dot) {
        check('E3 立即上划 ⇒ 淡入时长变化', false, '没有可用圆点');
    } else {
        const b = await readClip();
        await touch('touchStart', [{ id: 0, x: s.dot.cx, y: s.dot.cy }]);
        for (let i = 1; i <= 4; i += 1) {
            await touch('touchMove', [{ id: 0, x: s.dot.cx, y: s.dot.cy - (40 * i) / 4 }]);
            await sleep(40);
        }
        for (let i = 1; i <= 4; i += 1) {
            await touch('touchMove', [{ id: 0, x: s.dot.cx + (50 * i) / 4, y: s.dot.cy - 40 }]);
            await sleep(40);
        }
        await touch('touchEnd', []);
        await sleep(1400);
        const a = await readClip();
        check(
            'E3 立即上划（无等待）⇒ 淡入/淡出时长变化',
            a && b && (Math.abs(Number(a.fadeInSec) - Number(b.fadeInSec)) > 1e-3 || Math.abs(Number(a.fadeOutSec) - Number(b.fadeOutSec)) > 1e-3),
            `圆点=${JSON.stringify(s.dot)}  fadeIn ${b?.fadeInSec} → ${a?.fadeInSec}  fadeOut ${b?.fadeOutSec} → ${a?.fadeOutSec}  （对照：rate ${b?.rate} → ${a?.rate}）`,
        );
    }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 控制点方向探针：通过 ${pass} / ${results.length} ===`);
for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);