#!/usr/bin/env node
/**
 * #6 诊断：**指距 → 门控放行 → 实际结果（slip / 平移）** 的端到端关系。
 *
 * 背景：#6 的门控要求「两指都 hitTest 到**同一个 clip**」。用户手测「**始终平移**」
 * ⇒ 怀疑真实指距下有一指落不到块上（块只有 200px 宽左右、手指不精确）⇒ 门控恒假。
 *
 * 每个指距重建场景，报告：
 *   · 两指 x 与块的 [left, right]（**几何上**是否各自落在块内 —— 门控的期望值）
 *   · 650ms 后 `__hsTouchModifiers.alt`（门控**实际**有没有放行）
 *   · 随后两指一起左滑 40px、抬手后的**落库结果**：
 *       `ΔsourceStartSec/ΔsourceEndSec` ⇒ slip；`ΔscrollLeft` ⇒ 平移
 * ⇒ 用数据决定门控该收还是该放。
 *
 * 用法：node scripts/_dbg-twofinger-gate.mjs [--serial 221deeb]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
let wav = 'D:\\Temp\\hs-tone.wav';
for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--serial') serial = argv[++i];
    else if (argv[i] === '--wav') wav = argv[++i];
}

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
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

const scene = () =>
    cdp.call(() =>
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
                clipId: k.id,
                sourceStartSec: k.source_start_sec,
                sourceEndSec: k.source_end_sec,
                startSec: k.start_sec,
                lengthSec: k.length_sec,
                left: Math.round(left),
                right: Math.round(right),
                y: Math.round((rr ? rr.top + rr.height : c.top + 40) * 0.65),
                scrollLeft: Math.round(vp.scrollLeft),
                pxPerSec: vp.pxPerSec,
            };
        }),
    );

async function clearAll() {
    for (let i = 0; i < 5; i++) {
        const n = await cdp.call(() => window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => s.clips.length));
        if (n === 0) return;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
        await sleep(800);
    }
}

await cdp.call(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '停止');
    if (b) b.click();
});
await sleep(500);

const mods = () => cdp.call(() => (window.__hsTouchModifiers ? { ...window.__hsTouchModifiers } : null));

/* 先探"落点组合"：我探针里 B/Bp 通过的落点是 (154,132)/(190,132)，
   而按"块中点 ± 指距"算出的是 (324,105) 一带 —— 先确认是哪一侧的问题。 */
const probePoints = async (a, label, ax, ay, bx, by) => {
    await touch('touchStart', [{ id: 0, x: ax, y: ay }]);
    await sleep(90);
    await touch('touchStart', [
        { id: 0, x: ax, y: ay },
        { id: 1, x: bx, y: by },
    ]);
    await sleep(650);
    const alt = (await mods())?.alt ?? null;
    await touch('touchEnd', []);
    await sleep(600);
    const top = await cdp.call(
        (x, y) => {
            const el = document.elementFromPoint(x, y);
            const chain = [];
            let n = el;
            for (let i = 0; i < 5 && n; i += 1) {
                chain.push(`${n.tagName}${n.getAttribute && n.getAttribute('data-hs-pane') ? '[pane=' + n.getAttribute('data-hs-pane') + ']' : ''}`);
                n = n.parentElement;
            }
            const cont = window.__hsViewport && window.__hsViewport();
            return { tag: el ? `${el.tagName}.${String(el.className).slice(0, 30)}` : null, chain, contLeft: cont ? cont.containerRect.left : null };
        },
        ax,
        ay,
    );
    console.log(`${label}: 落点(${ax},${ay})/(${bx},${by})  afterHold.alt=${alt}  该点顶层=${top.tag}  链=${JSON.stringify(top.chain)}`);
};

{
    await clearAll();
    await cdp.call((b) => window.__hsImportAudioBase64('gate2.wav', b, 0), readFileSync(wav).toString('base64'));
    await sleep(1600);
    const a = await scene();
    const cRect = await cdp.call(() => {
        const vp = window.__hsViewport();
        return { left: Math.round(vp.containerRect.left), top: Math.round(vp.containerRect.top), w: Math.round(vp.containerRect.width), h: Math.round(vp.containerRect.height) };
    });
    console.log('容器：', JSON.stringify(cRect));
    console.log('块：', JSON.stringify(a));
    if (a) {
        /* 扫描 x：两指相距 20px、y 固定在 132，找门控放行的区间。 */
        const okXs = [];
        for (let x = 140; x <= 356; x += 16) {
            await touch('touchStart', [{ id: 0, x, y: 132 }]);
            await sleep(80);
            await touch('touchStart', [
                { id: 0, x, y: 132 },
                { id: 1, x: x + 20, y: 132 },
            ]);
            await sleep(620);
            const alt = (await mods())?.alt ?? null;
            await touch('touchEnd', []);
            await sleep(450);
            if (alt) okXs.push(x);
            process.stdout.write(`x=${x}:${alt ? 'P' : '.'} `);
        }
        console.log('\n放行的左指 x：', JSON.stringify(okXs));
    }
}
cdp.close();
process.exit(0);

console.log('指距 | 块[left,right] y | 两指x（几何在块内？） | afterHold.alt | 结果');
for (const gap of [20, 40, 60, 80, 100, 140]) {
    await clearAll();
    await cdp.call((b) => window.__hsImportAudioBase64('gate.wav', b, 0), readFileSync(wav).toString('base64'));
    await sleep(1500);
    const a = await scene();
    if (!a) {
        console.log('  建场景失败');
        continue;
    }
    const mid = (a.left + a.right) / 2;
    const p0 = { id: 0, x: Math.round(mid - gap / 2), y: a.y };
    const p1 = { id: 1, x: Math.round(mid + gap / 2), y: a.y };
    const inOf = (x) => x >= a.left && x <= a.right;
    await touch('touchStart', [{ id: 0, x: p0.x, y: p0.y }]);
    await sleep(90);
    await touch('touchStart', [
        { id: 0, x: p0.x, y: p0.y },
        { id: 1, x: p1.x, y: p1.y },
    ]);
    await sleep(650); /* 越过 500ms 门控 */
    const alt = (await mods())?.alt ?? null;
    /* 两指一起左滑 40px（能把 scrollLeft 推离 0 ⇒ 平滑能看见变化）。 */
    for (let i = 1; i <= 5; i++) {
        await touch('touchMove', [
            { id: 0, x: Math.round(p0.x - (40 * i) / 5), y: p0.y },
            { id: 1, x: Math.round(p1.x - (40 * i) / 5), y: p1.y },
        ]);
        await sleep(50);
    }
    await touch('touchEnd', []);
    await sleep(1200);
    const b2 = await scene();
    const dSrc =
        b2 && a
            ? {
                  s: +(Number(b2.sourceStartSec) - Number(a.sourceStartSec)).toFixed(4),
                  e: +(Number(b2.sourceEndSec) - Number(a.sourceEndSec)).toFixed(4),
              }
            : null;
    const dScroll = b2 ? Math.round(b2.scrollLeft - a.scrollLeft) : null;
    const isSlip = dSrc && (Math.abs(dSrc.s) > 1e-3 || Math.abs(dSrc.e) > 1e-3);
    console.log(
        `${String(gap).padStart(3)}px | [${a.left},${a.right}] y=${a.y} | ` +
            `${p0.x}(${inOf(p0.x) ? '内' : '外'}) ${p1.x}(${inOf(p1.x) ? '内' : '外'}) | ` +
            `alt=${alt} | ${isSlip ? '✅ slip' : '⬜ 未 slip'}  Δ源=${JSON.stringify(dSrc)} Δscroll=${dScroll}`,
    );
}
cdp.close();
