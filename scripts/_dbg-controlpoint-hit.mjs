#!/usr/bin/env node
/**
 * 诊断：块外控制点被"按"时，内核到底有没有收到。
 *
 * 用户口径（2026-10-03）："拖控制点调倍速/淡入出失效了"。
 * 探针 `_probe-control-point.mjs` 从 7/7 掉到 1/6 ⇒ 要区分两种可能：
 *   A. 命中不到（触摸被别的 DOM 吃掉 / 圆点坐标与内核命中带错位）
 *   B. 命中到了但手势没生效（长按定型分支坏了）
 *
 * 手法：
 *   1. 直接读圆点位置，以及 `elementFromPoint(圆点)` 的**祖先链**（谁在最上层）；
 *   2. 在圆点上按住 650ms（> 内核 `TOUCH_EDGE_HOLD_MS = 500`），
 *      读 `__hsClipProbe().hint` —— 内核只有在**命中 left/right-edge** 时才会
 *      在长按成立后点亮那个提示图标 ⇒ hint 在场 = 命中到了（排除 A）。
 *
 * 用法：node scripts/_dbg-controlpoint-hit.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9222;

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const probe = window.__hsClipProbe ? window.__hsClipProbe() : null;
        const sel = window.__hsSelection ? window.__hsSelection() : null;
        const dot = (side) => {
            const el = document.querySelector(`[data-hs-clip-control-point="${side}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        };
        const dR = dot('right');
        const dL = dot('left');
        const target = dR ?? dL;
        /** 从落点往上爬，记下每层的 tag + 关键 data 属性（谁是"最上层那个"。 */
        const chainOf = (x, y) => {
            const el = document.elementFromPoint(x, y);
            const out = [];
            let n = el;
            for (let i = 0; n && i < 12; i += 1) {
                const attrs = [...n.attributes]
                    .map((a) => a.name)
                    .filter((a) => a.startsWith('data-hs') || a === 'class' || a === 'role')
                    .map((a) => `${a}=${String(n.getAttribute(a)).slice(0, 40)}`);
                const r = n.getBoundingClientRect();
                out.push({
                    tag: n.tagName.toLowerCase(),
                    attrs,
                    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','),
                    pe: getComputedStyle(n).pointerEvents,
                    z: getComputedStyle(n).zIndex,
                });
                n = n.parentElement;
            }
            return out;
        };
        const rowRect = (() => {
            const rows = [...document.querySelectorAll('[data-hs-track-row]')];
            return rows.map((r) => {
                const b = r.getBoundingClientRect();
                return {
                    id: r.getAttribute('data-hs-track-row').slice(0, 10),
                    rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(','),
                };
            });
        })();
        const selRect = (() => {
            const el = document.querySelector('[data-hs-clip-selected="1"]');
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { tag: el.tagName.toLowerCase(), rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)].join(',') };
        })();
        return {
            dot: target,
            dotLeft: dL,
            dotRight: dR,
            vp: vp ? { pxPerSec: vp.pxPerSec, scrollLeft: vp.scrollLeft, rowHeight: vp.rowHeight, containerRect: vp.containerRect } : null,
            probe,
            sel,
            selRect,
            rowRect,
            chain: target ? chainOf(target.x, target.y) : null,
            actionsOn: Boolean(document.querySelector('[data-hs-clip-actions]')),
        };
    });
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch { /* ignore */ }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });

    const s = await cdp.call(inPage);
    console.log('── 几何 ──');
    console.log('  dot        =', JSON.stringify(s.dot), ' left=', JSON.stringify(s.dotLeft), ' right=', JSON.stringify(s.dotRight));
    console.log('  vp         =', JSON.stringify(s.vp));
    console.log('  rowRect    =', JSON.stringify(s.rowRect));
    console.log('  selRect    =', JSON.stringify(s.selRect));
    console.log('  sel        =', JSON.stringify(s.sel));
    console.log('  clipProbe  =', JSON.stringify(s.probe?.clip));
    console.log('  actionsOn  =', s.actionsOn);
    console.log('── 落点最上层元素链（由内向外）──');
    for (const n of s.chain ?? []) console.log('  ', n.tag, `rect=${n.rect}`, `pe=${n.pe}`, `z=${n.z}`, n.attrs.join(' '));

    if (s.dot === null) { console.log('（没有圆点 ⇒ 后面不可测）'); cdp.close(); return; }

    console.log('── 按住圆点 650ms（> 内核 500ms 门槛），看内核有没有点亮长按提示 ──');
    await touch('touchStart', [{ x: s.dot.x, y: s.dot.y }]);
    await sleep(650);
    const afterHold = await cdp.call(inPage);
    console.log('  probe.hint =', JSON.stringify(afterHold.probe?.hint));
    console.log('  选中块     =', JSON.stringify(afterHold.probe?.clip));
    const modeDuring = await cdp.call(() => {
        const d = document.querySelector('[data-hs-clip-control-point="right"]') ?? document.querySelector('[data-hs-clip-control-point="left"]');
        return d ? d.getAttribute('data-hs-control-mode') : null;
    });
    console.log('  control-mode（按住时）=', modeDuring);
    await touch('touchEnd', []);
    await sleep(400);
    const afterUp = await cdp.call(inPage);
    console.log('  松手后块   =', JSON.stringify(afterUp.probe?.clip));
    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
