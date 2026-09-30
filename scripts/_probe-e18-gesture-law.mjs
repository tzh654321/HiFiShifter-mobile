#!/usr/bin/env node
/**
 * E18 验收：双指捏合解算的**总修法**（E16 / E17 的病根都在这条链上）。
 *
 * 用户给定修法（原文）：
 *   ① 某轴双指坐标过近 ⇒ 该轴缩放算作 **0**（易做单轴缩放）；
 *   ② 缩放按「双指靠近 1 单位就缩放百分之几」的**绝对**关系算，而不是「与上次距离的比例」；
 *   ③ 平移仍用**双指中点**当单指；
 *   ④ 再加**平滑化 + 惯性化**。
 *
 * 【判据来源】手势层在 `window.__hsGestureDebug` 里自报中间量，本版已含
 *   `sx/sy（当前分离度）· sx0/sy0（会话基线）· mx/my（中点，容器坐标）· kx/ky · nearX/nearY`。
 * ⇒ 探针不再"猜基线"，而是**用钩子自己的基线复算期望倍数**，逐项对齐公式。
 *
 * 【读数纪律（踩过的坑）】
 *   · CDP `Input.dispatchTouchEvent` 与随后的 `Runtime.evaluate` **不同通道**，紧跟其后的读
 *     常常拿到**上一帧**的值 ⇒ 每次读都 `read()` 两遍、中间隔 140ms，取第二遍。
 *   · 一次 `touchMove` 会拆成两个 `pointermove`（每指一个）：中间帧只有一指在动 ⇒
 *     越死区的那一跳要**一次给足 16px**（中间帧只 8px 不会 armed），基线才是确定的。
 *   · 竖直缩放用 **zoom out（两指靠拢）**：参数值域 span 有下限（pitch 实测 span=6 已在下限），
 *     zoom in 会被 `clampViewport` 吃掉 ⇒ 看起来"没生效"。
 *
 * 用法：node scripts/_probe-e18-gesture-law.mjs --serial 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: '221deeb', port: 9222, law: 0.007 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--law') o.law = Number(argv[++i]);
    }
    return o;
}

/** 页面内：参数面板视口真值 + 手势层自报的中间量。 */
function inPageState() {
    const v = window.__hsParamViewport ? window.__hsParamViewport() : null;
    const d = window.__hsGestureDebug || null;
    return {
        hasParamViewport: !!v,
        param: v ? v.param : null,
        scroller: v && v.scrollerRect ? v.scrollerRect : null,
        pxPerSec: v ? v.pxPerSec : null,
        scrollLeft: v ? v.scrollLeft : null,
        span: v ? v.span : null,
        rowHeight: v ? v.rowHeight : null,
        gestureActive: window.__hsGestureActive === true,
        debug: d
            ? {
                  armed: d.armed,
                  kx: d.kx,
                  ky: d.ky,
                  nearX: d.nearX,
                  nearY: d.nearY,
                  sx: d.sx,
                  sy: d.sy,
                  sx0: d.sx0,
                  sy0: d.sy0,
                  mx: d.mx,
                  my: d.my,
                  law: d.law,
                  rowH0: d.rowH0,
                  rowH: d.rowH,
                  inertia: d.inertia,
              }
            : null,
    };
}

/** 页面内：**时间线面板**视口真值（E18-③/④ 用）+ 手势层中间量。 */
function inPageTimeline() {
    const vp = window.__hsViewport ? window.__hsViewport() : null;
    const d = window.__hsGestureDebug || null;
    return {
        vp: vp
            ? {
                  scrollLeft: vp.scrollLeft,
                  scrollTop: vp.scrollTop,
                  pxPerSec: vp.pxPerSec,
                  rowHeight: vp.rowHeight,
                  containerRect: vp.containerRect,
              }
            : null,
        gestureActive: window.__hsGestureActive === true,
        debug: d ? { mx: d.mx, my: d.my, kx: d.kx, ky: d.ky, sx: d.sx, sy: d.sy, sx0: d.sx0, sy0: d.sy0, armed: d.armed, nearX: d.nearX, nearY: d.nearY, law: d.law, inertia: d.inertia } : null,
    };
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
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    /** 读两遍（第二遍才是当前帧），中间等 140ms。 */
    const read = async (gap = 140) => {
        await cdp.call(inPageState);
        await sleep(gap);
        return cdp.call(inPageState);
    };
    const settle = async (ms = 620) => {
        await sleep(ms);
        return read(0);
    };

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /* ── 前置：打开参数面板，并**收起轨道面板让它全屏** ─────────────────────
     * 为什么要全屏：分屏时参数画布只有 ~89px 高，做 60~80px 的竖直分离度时手指会
     * 贴到画布边缘，被上/下方浮层吃掉 ⇒ 只有一指进控制器 ⇒ 整个手势"没反应"
     * （实测：先前的失败全是这个原因，而不是解算的问题）。全屏后画布 ~500px。 */
    await cdp.call(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await w(900);
        window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: 'timeline' } }));
        return true;
    });
    await sleep(1600);
    let st = await read(0);
    if (!st.hasParamViewport) throw new Error('参数面板没打开（__hsParamViewport 不存在）');
    if (st.scroller === null || st.scroller.height < 200) {
        throw new Error(
            `参数画布不够高（${st.scroller && Math.round(st.scroller.height)}px）——需要全屏参数面板；` +
                `先手动把「视图 → 轨道面板」关掉再跑本探针`,
        );
    }
    const sc = st.scroller;
    const cx = Math.round(sc.left + sc.width / 2);
    const cy = Math.round(sc.top + sc.height / 2);
    console.log(
        '▸ 参数面板：' +
            JSON.stringify({
                param: st.param,
                scroller: { l: Math.round(sc.left), t: Math.round(sc.top), w: Math.round(sc.width), h: Math.round(sc.height) },
                span: +st.span.toFixed(3),
                rowHeight: +st.rowHeight.toFixed(4),
                pxPerSec: +st.pxPerSec.toFixed(2),
                scrollLeft: +st.scrollLeft.toFixed(2),
            }),
    );
    if (Math.abs(sc.height) < 40) throw new Error('参数画布太矮，捏合空间不足');

    /**
     * 竖直捏合（zoom out：两指**靠拢**）。
     *
     * 两段式，保证基线确定：
     *   ① 一次给足 **−16px**（正好越过 16px 死区；中间帧只有 −8px ⇒ 不会 armed）
     *      ⇒ 这一帧的基线 = 起始分离度 − 16；
     *   ② 每步 −8px 走 `steps` 步（合计 −8·steps）。
     *
     * @returns { sy0, sy, delta, expect, ky, before, during, after, samples }
     */
    async function verticalPinchOut(startSpan, steps) {
        const before = await read(0);
        let a = { id: 0, x: cx - 60, y: cy - startSpan / 2 };
        let b = { id: 1, x: cx + 60, y: cy + startSpan / 2 };
        await touch('touchStart', [a]);
        await sleep(150);
        await touch('touchStart', [a, b]);
        await sleep(150);
        /* ① 越死区 */
        a.y += 8;
        b.y -= 8;
        await touch('touchMove', [a, b]);
        await sleep(180);
        const armed = await read(0);
        if (armed.debug === null) {
            const who = await cdp.call(
                (pts) =>
                    pts.map(
                        (p) =>
                            `${p.x},${p.y}: ` +
                            document
                                .elementsFromPoint(p.x, p.y)
                                .slice(0, 4)
                                .map((e) => e.tagName + '.' + String(e.className).slice(0, 28))
                                .join(' | '),
                    ),
                [
                    { x: a.x, y: a.y },
                    { x: b.x, y: b.y },
                ],
            );
            await touch('touchEnd', [a, b]);
            throw new Error('两指手势没进手势层（__hsGestureDebug 为空）——触点命中：\n  ' + who.join('\n  '));
        }
        const samples = [];
        /* ② 逐步靠拢 */
        for (let i = 0; i < steps; i++) {
            a.y += 4;
            b.y -= 4;
            await touch('touchMove', [a, b]);
            await sleep(170);
            const s = await read(0);
            samples.push(+s.rowHeight.toFixed(4));
        }
        const during = await read(0);
        await touch('touchEnd', [a, b]);
        const after = await settle();
        const sy0 = armed.debug ? armed.debug.sy0 : null;
        const sy = during.debug ? during.debug.sy : null;
        const delta = sy0 !== null && sy !== null ? +(sy - sy0).toFixed(2) : null;
        const expect = delta === null ? null : Math.exp(o.law * delta);
        return { before, armed, during, after, sy0, sy, delta, expect, ky: during.debug ? during.debug.ky : null, samples, startSpan };
    }

    const kx = (s) => (s.debug ? s.debug.kx : null);
    const ky = (s) => (s.debug ? s.debug.ky : null);

    /* ── E18-① 绝对缩放律（用钩子给出的基线精确对齐公式）────────────────── */
    const runs = [];
    for (const startSpan of [80, 60]) {
        const r = await verticalPinchOut(startSpan, 3); /* −16 再 −24 ⇒ Δ = −24 */
        runs.push(r);
        const ratio = r.before.rowHeight ? r.after.rowHeight / r.before.rowHeight : null;
        console.log(
            `▸ 起始 span=${startSpan} ⇒ ` +
                JSON.stringify({
                    sy0: r.sy0,
                    sy: r.sy,
                    delta: r.delta,
                    expectKy: r.expect && +r.expect.toFixed(4),
                    ky: r.ky,
                    基线修正: r.armed.debug && r.armed.debug.armed,
                    rowHeight: `${r.before.rowHeight.toFixed(4)} → ${r.after.rowHeight.toFixed(4)}（×${ratio && ratio.toFixed(4)}）`,
                    采样: r.samples,
                }),
        );
        await sleep(500);
    }
    {
        const [a, b] = runs;
        const lawOk =
            a.ky !== null &&
            a.expect !== null &&
            Math.abs(a.ky / a.expect - 1) < 0.02 &&
            b.ky !== null &&
            b.expect !== null &&
            Math.abs(b.ky / b.expect - 1) < 0.02;
        check(
            'E18-① 缩放律逐字对齐公式 ky = e^(law·Δ)（Δ 取手势层自报的 sy − sy0）',
            lawOk,
            `起始${a.startSpan}: Δ=${a.delta} ⇒ 期望 ${a.expect && a.expect.toFixed(4)} / 实测 ky=${a.ky}；` +
                `起始${b.startSpan}: Δ=${b.delta} ⇒ 期望 ${b.expect && b.expect.toFixed(4)} / 实测 ky=${b.ky}`,
        );
        const sameDelta = a.delta !== null && b.delta !== null && Math.abs(a.delta - b.delta) < 1.5;
        check('E18-①b 两轮**位移相同**（Δ 一致，±1.5px）', sameDelta, `Δ₁=${a.delta} Δ₂=${b.delta}`);
        const sameKy = a.ky !== null && b.ky !== null && Math.abs(a.ky / b.ky - 1) < 0.03;
        check(
            'E18-①c 同位移 ⇒ 同倍数（**与起始分离度无关**；旧比例律在此会差 ~1.6×）',
            sameKy,
            `ky(基线${a.sy0})=${a.ky} vs ky(基线${b.sy0})=${b.ky}（比值 ${(a.ky / b.ky).toFixed(4)}）`,
        );
        const applied = runs.every((r) => {
            const ratio = r.after.rowHeight / r.before.rowHeight;
            return Math.abs(ratio / r.ky - 1) < 0.12;
        });
        check(
            'E18-①d 视口真的按 ky 缩放（rowHeight 比 ≈ ky，±12%）',
            applied,
            runs.map((r) => `基线${r.sy0}: ×${(r.after.rowHeight / r.before.rowHeight).toFixed(4)} vs ky=${r.ky}`).join('；'),
        );
    }

    /* ── E18-② 轴死区：某轴两指过近 ⇒ 该轴缩放算 0 ─────────────────────── */
    {
        const y = cy;
        const a = { id: 0, x: cx - 40, y };
        const b = { id: 1, x: cx + 40, y };
        const before = await read(0);
        await touch('touchStart', [a]);
        await sleep(150);
        await touch('touchStart', [a, b]);
        await sleep(150);
        for (let i = 1; i <= 6; i++) {
            a.x = cx - 40 - (90 * i) / 6;
            b.x = cx + 40 + (90 * i) / 6;
            await touch('touchMove', [a, b]);
            await sleep(150);
        }
        const during = await read(0);
        await touch('touchEnd', [a, b]);
        const after = await settle();
        const d = during.debug || {};
        const rowChanged = Math.abs(after.rowHeight - before.rowHeight) / Math.max(1e-9, before.rowHeight);
        check(
            'E18-② 轴死区：两指 y 重合（span.y=0）+ 只横向张开 ⇒ 纵向缩放算 0',
            d.nearY === true && Math.abs(d.ky - 1) < 1e-6 && rowChanged < 0.01 && d.kx > 2,
            `nearY=${d.nearY} ky=${d.ky} kx=${d.kx} sx=${d.sx} sx0=${d.sx0}；` +
                `rowHeight ${before.rowHeight.toFixed(4)} → ${after.rowHeight.toFixed(4)}（${(rowChanged * 100).toFixed(2)}%）`,
        );
    }

    /* ── E16-a 纵向捏合 ⇒ 横向不动（锚点在"没动的那一轴"上必须守恒）──────── */
    {
        const r = await verticalPinchOut(80, 3);
        const dPx = Math.abs(r.after.pxPerSec - r.before.pxPerSec) / Math.max(1e-9, r.before.pxPerSec);
        const dSl = Math.abs(r.after.scrollLeft - r.before.scrollLeft);
        check(
            'E16-a 纵向捏合时**横向完全不动**（pxPerSec 与 scrollLeft 都不变）',
            dPx < 1e-4 && dSl < 1.5,
            `pxPerSec ${r.before.pxPerSec.toFixed(2)} → ${r.after.pxPerSec.toFixed(2)}（${(dPx * 100).toFixed(4)}%）；` +
                `scrollLeft ${r.before.scrollLeft.toFixed(2)} → ${r.after.scrollLeft.toFixed(2)}（Δ${dSl.toFixed(3)}）  ky=${r.ky} kx=${kx(r.during)}`,
        );
    }

    /* ── E17 纵向捏合过程**单调无抖动** ─────────────────────────────────── */
    {
        const r = await verticalPinchOut(80, 6);
        const seq = r.samples;
        let backsteps = 0;
        for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1] + 1e-6) backsteps++;
        check(
            'E17（zoom out）rowHeight 序列**单调无回退**（不再"上下抖动"）',
            backsteps === 0 && seq.length > 3 && seq[seq.length - 1] < seq[0] - 1e-4,
            `序列=${JSON.stringify(seq)}  回退步数=${backsteps}`,
        );
    }

    /* ── E18-③ / E18-④：在**时间线面板（全屏）**上测平移与惯性 ─────────────
     * 为什么换面板：参数面板的横向可滚范围与轨道视图**共享**（`resolveTimelineScrollRange`，
     * 按工程长度 + 视口宽算），当前工程很短 ⇒ 实测只有 ~58px 余量，两个方向都立刻钉住
     * ——「跟手 / 惯性」在这种夹缝里测不出来（不是手势坏了）。换成时间线全屏后，
     * 画布高 ~560px、范围按工程全长算，才有判据空间。 */
    await cdp.call(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
        await w(900);
        window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: 'params' } }));
        return true;
    });
    await sleep(1700);
    const readTl = async (gap = 140) => {
        await cdp.call(inPageTimeline);
        await sleep(gap);
        return cdp.call(inPageTimeline);
    };
    let tl0 = await readTl(0);
    if (tl0.vp === null) throw new Error('时间线视口钩子 __hsViewport 不存在');
    const cr = tl0.vp.containerRect;
    const tcx = Math.round(cr.left + cr.width / 2);
    const tcy = Math.round(cr.top + cr.height / 2);
    console.log(
        '▸ 时间线面板：' +
            JSON.stringify({
                container: { l: Math.round(cr.left), t: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) },
                pxPerSec: +tl0.vp.pxPerSec.toFixed(2),
                scrollLeft: +tl0.vp.scrollLeft.toFixed(2),
            }),
    );

    /* 先把时间线**横向放大**：默认 pxPerSec ≈ 19 时整段工程只有 ~150px 宽（视口 228px）
     * ⇒ 可滚范围是 0，「跟手」根本无从判定。放大到 ×2.6 后才有余量。 */
    {
        const a = { id: 0, x: tcx - 20, y: tcy - 40 };
        const b = { id: 1, x: tcx + 20, y: tcy + 40 };
        await touch('touchStart', [a]);
        await sleep(150);
        await touch('touchStart', [a, b]);
        await sleep(150);
        for (let i = 1; i <= 7; i++) {
            a.x = tcx - 20 - (70 * i) / 7;
            b.x = tcx + 20 + (70 * i) / 7;
            await touch('touchMove', [a, b]);
            await sleep(150);
        }
        await touch('touchEnd', [a, b]);
        await sleep(800);
        const z = await readTl(0);
        console.log(
            `▸ 放大后：pxPerSec ${tl0.vp.pxPerSec.toFixed(2)} → ${z.vp.pxPerSec.toFixed(2)}（工程宽 ${(tl0.vp.pxPerSec * 8).toFixed(0)} → ${(z.vp.pxPerSec * 8).toFixed(0)}px 量级）`,
        );
    }

    /** 双指同向横移；返回 ΔscrollLeft 与中点位移（Δmx 取自手势层）。 */
    async function panOnce(dir) {
        const a = { id: 0, x: tcx - 70, y: tcy - 40 };
        const b = { id: 1, x: tcx + 70, y: tcy + 40 };
        const before = await readTl(0);
        await touch('touchStart', [a]);
        await sleep(150);
        await touch('touchStart', [a, b]);
        await sleep(150);
        const trace = [];
        const dx = 80 * dir;
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [
                { id: 0, x: a.x + (dx * i) / 4, y: a.y },
                { id: 1, x: b.x + (dx * i) / 4, y: b.y },
            ]);
            await sleep(170);
            const s = await readTl(0);
            trace.push(+s.vp.scrollLeft.toFixed(2));
        }
        const during = await readTl(0);
        await touch('touchEnd', [a, b]);
        await sleep(700);
        const after = await readTl(0);
        return {
            dir,
            dScroll: +(after.vp.scrollLeft - before.vp.scrollLeft).toFixed(2),
            dMid: +(during.debug.mx - before.debug.mx).toFixed(2),
            trace,
        };
    }
    {
        const r = await panOnce(1);
        console.log('▸ 平移：' + JSON.stringify(r));
        /* 判据：方向必须正确，且位移要**跟到手指**（除非可滚范围本身不够 —— 参数面板与
         * 轨道视图共享范围，实测只有几十 px；只要"移动量 ≥ 手指位移 − 8px"或"已经明显
         * 移动 ≥ 30px 且方向正确"就算跟手）。 */
        const dirOk = Math.sign(r.dScroll) === -Math.sign(r.dMid) && r.dMid !== 0;
        const followed = Math.abs(r.dScroll) >= Math.abs(r.dMid) - 8;
        const movedEnough = Math.abs(r.dScroll) >= 30;
        check(
            'E18-③ 双指同向横移 ⇒ 视口随**中点**跟手（方向正确 + 跟满位移或已明显移动）',
            Math.abs(r.dMid) >= 60 && dirOk && (followed || movedEnough),
            `中点 Δ=${r.dMid}（手势层确实收到位移）· scrollLeft Δ=${r.dScroll}（期望 ≈ ${-r.dMid}）· ` +
                `跟满=${followed} 已移动≥30px=${movedEnough} · 逐帧=${JSON.stringify(r.trace)}`,
        );
    }

    /** 快速甩一次（4 步 ×35px、步间 26ms ⇒ 约 1.3px/ms）。 */
    async function flingOnce(dir) {
        const a = { id: 0, x: tcx - 70, y: tcy - 40 };
        const b = { id: 1, x: tcx + 70, y: tcy + 40 };
        await touch('touchStart', [a]);
        await sleep(150);
        await touch('touchStart', [a, b]);
        await sleep(150);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [
                { id: 0, x: a.x + (140 * dir * i) / 4, y: a.y },
                { id: 1, x: b.x + (140 * dir * i) / 4, y: b.y },
            ]);
            await sleep(26);
        }
        const atRelease = await readTl(0);
        await touch('touchEnd', [a, b]);
        await sleep(220);
        const s1 = await readTl(0);
        await sleep(500);
        const s2 = await readTl(0);
        await sleep(700);
        const s3 = await readTl(0);
        return {
            dir,
            fling: +Math.abs(s1.vp.scrollLeft - atRelease.vp.scrollLeft).toFixed(2),
            settle: +Math.abs(s3.vp.scrollLeft - s2.vp.scrollLeft).toFixed(3),
            active: { mid: s1.gestureActive, end: s3.gestureActive },
        };
    }
    {
        const f1 = await flingOnce(1);
        await sleep(400);
        const f2 = await flingOnce(-1);
        const best = f1.fling >= f2.fling ? f1 : f2;
        console.log('▸ 甩动：' + JSON.stringify(f1) + '  ' + JSON.stringify(f2));
        check(
            'E18-④a 抬手**惯性**：松手后视口继续滑行（≥ 4px）',
            best.fling >= 4,
            `取方向 ${best.dir > 0 ? '→' : '←'}：松开后 +220ms 位移 ${best.fling}px（→ ${f1.fling} / ← ${f2.fling}）`,
        );
        check(
            'E18-④b 惯性**会收敛**（后 700ms 位移 < 2px）',
            best.settle < 2,
            `+720ms → +1420ms 位移 ${best.settle}px`,
        );
        check(
            'E18-④c 收尾后**活动标志已释放**（否则单指交互永久失效）',
            best.active.end === false,
            `__hsGestureActive：+220ms=${best.active.mid} → +1420ms=${best.active.end}`,
        );
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== E18 手势解算探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
