#!/usr/bin/env node
/**
 * #2 验收：**多选音频块批量处理**（用户 2026-10-04）
 *
 * 用户口径：
 *   「框选多个音频块后应该在**最左侧音频块左侧**和**最右侧音频块右侧**添加控制点，
 *     并显示常用功能菜单，能批量拉伸、裁剪、调 fade、使用菜单功能（类似电脑版）」
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────────
 *   M1 多选后**左右各一个**控制点圆点（修复前 `g.multiSelectedCount > 1 ⇒ return null`
 *      ⇒ 一个都不画）
 *   M1b 左圆点圆心 ≈ **最左块的左缘**；右圆点圆心 ≈ **最右块的右缘**
 *   M2 常用功能浮条 `[data-hs-clip-actions]` 在場（修复前多选直接 return null）
 *   M3 拖**左圆点**（右移）⇒ **两块都被裁切**（左缘内收）——批量裁剪
 *   M4 拖**右圆点**（左移）⇒ **两块右缘都内收** —— 批量裁剪（另一侧）
 *
 * 造多选：`hifi:timelineEditOp` 的 `selectAll`（它同时设 `multiSelectedClipIds`
 * 与焦点 clip，正是框选之后的等价状态）。
 *
 * 用法：node scripts/_probe-e41-multiselect.mjs --serial 221deeb [--dx 26]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: '221deeb', port: 9222, wav: 'D:\\Temp\\hs-tone.wav', dx: 26, insertAt: 1.0 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
        else if (a === '--dx') o.dx = Number(argv[++i]);
        else if (a === '--at') o.insertAt = Number(argv[++i]);
    }
    return o;
}

/** 页面内：读工程状态 + 每个块的渲染矩形（与浮层同一套公式）。 */
function inPageGeometry() {
    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    return invoke('get_timeline_state').then((state) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        if (!vp) return { error: 'no-viewport' };
        const c = vp.containerRect;
        const trackOrder = (state.tracks || []).map((t) => t.id);
        const all = [...(state.clips || [])]
            .sort((a, b) => {
                const ra = trackOrder.indexOf(a.track_id) - trackOrder.indexOf(b.track_id);
                return ra !== 0 ? ra : a.start_sec - b.start_sec;
            })
            .map((raw) => {
                const rowEl = document.querySelector(`[data-hs-track-row="${raw.track_id}"]`);
                const rr = rowEl ? rowEl.getBoundingClientRect() : null;
                const top = rr ? rr.top : c.top - vp.scrollTop;
                const h = rr ? rr.height : vp.rowHeight;
                const left = c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft;
                const w = raw.length_sec * vp.pxPerSec;
                return {
                    id: raw.id,
                    startSec: raw.start_sec,
                    lengthSec: raw.length_sec,
                    sourceStartSec: raw.source_start_sec,
                    sourceEndSec: raw.source_end_sec,
                    trackId: raw.track_id,
                    rect: {
                        left: Math.round(left),
                        right: Math.round(left + w),
                        top: Math.round(top),
                        height: Math.round(Math.max(1, h - 2)),
                    },
                };
            });
        return {
            clips: all,
            viewport: { pxPerSec: vp.pxPerSec, scrollLeft: vp.scrollLeft, containerRect: c },
        };
    });
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`)
        .toString()
        .trim()
        .replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`);

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p) => ({
                id: p.id,
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

    /* 停播（播放态会覆写 playhead）。 */
    await cdp.call(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.ariaLabel === '停止');
        if (btn) btn.click();
    });
    await sleep(600);

    async function clearAll() {
        for (let guard = 0; guard < 6; guard++) {
            const before = await cdp.call(inPageGeometry);
            if (!before.clips || before.clips.length === 0) return;
            await cdp.call(() => {
                const fire = (op) =>
                    window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
                fire('selectAll');
                fire('delete');
            });
            await sleep(900);
        }
    }

    /** 造场景：清空 → 在 `insertAt` 秒处导入 → 缩放 → seek 40% → split ⇒ 2 个块。 */
    async function buildScene(label) {
        await clearAll();
        const b64 = readFileSync(o.wav).toString('base64');
        await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), label, b64, o.insertAt);
        await sleep(1500);
        /* 点空白（归属编辑表面）取消选中，避免"导入自带选中"影响后续。 */
        const g0 = await cdp.call(inPageGeometry);
        const c0 = g0.viewport.containerRect;
        await tap(Math.round(c0.left + c0.width * 0.85), Math.round(c0.top + c0.height - 120));
        /* 缩到容器宽 85%。 */
        for (let i = 0; i < 8; i++) {
            const g = await cdp.call(inPageGeometry);
            const endSec = Math.max(...g.clips.map((x) => x.startSec + x.lengthSec));
            const want = (g.viewport.containerRect.width * 0.85) / Math.max(0.001, endSec);
            const factor = Math.min(8, Math.max(0.125, want / g.viewport.pxPerSec));
            if (Math.abs(factor - 1) < 0.02) break;
            await cdp.call(
                (f) =>
                    window.dispatchEvent(
                        new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } }),
                    ),
                factor,
            );
            await sleep(220);
        }
        /* seek 到左块中部再 split（split 在播放头处切）。 */
        const g1 = await cdp.call(inPageGeometry);
        const clip0 = g1.clips[0];
        const sec = clip0.startSec + clip0.lengthSec * 0.55;
        const x = Math.round(
            g1.viewport.containerRect.left + sec * g1.viewport.pxPerSec - g1.viewport.scrollLeft,
        );
        const rulerY = await cdp.call(() => {
            const r = document.querySelector('[data-hs-time-ruler="timeline"]');
            if (r) {
                const rr = r.getBoundingClientRect();
                return Math.round(rr.top + rr.height / 2);
            }
            return Math.round(window.__hsViewport().containerRect.top - 24);
        });
        await tap(x, rulerY);
        await cdp.call(() => {
            const fire = (op) =>
                window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('split');
        });
        await sleep(1300);
        const g2 = await cdp.call(inPageGeometry);
        if (g2.clips.length !== 2) throw new Error(`split 后应有 2 个块，实得 ${g2.clips.length}`);
        return g2;
    }

    /* ── 1. 造场景 + 全选（= 多选 2 块）──────────────────────────────────── */
    await buildScene(`hs-ms-${Date.now()}.wav`);
    await cdp.call(() => {
        window.dispatchEvent(
            new CustomEvent('hifi:timelineEditOp', { detail: { op: 'selectAll' } }),
        );
    });
    await sleep(900);

    const before = await cdp.call(inPageGeometry);
    /* 浮层读数：控制点 / 浮条。 */
    const overlay = await cdp.call(() => {
        const dots = [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
                side: el.getAttribute('data-hs-clip-control-point'),
                cx: Math.round(r.left + r.width / 2),
                cy: Math.round(r.top + r.height / 2),
            };
        });
        const bar = document.querySelector('[data-hs-clip-actions]');
        const br = bar ? bar.getBoundingClientRect() : null;
        return {
            dots,
            bar: br
                ? {
                      left: Math.round(br.left),
                      right: Math.round(br.right),
                      top: Math.round(br.top),
                      cy: Math.round(br.top + br.height / 2),
                  }
                : null,
        };
    });

    /* ⚠️ 左端点取 **min(left)**，右端点取 **max(right)** —— 排序方向别弄反（第一版把
       `right` 也按升序取首个 ⇒ 拿到的其实是**最左**块的右缘，误判成"圆点位置错"）。
       另外圆点按设计贴在边**外侧** `DOT_R + 3 = 10px`（与内核命中带对齐）⇒ 期望值要带上这 10px。 */
    const DOT_OFFSET = 10;
    const leftMost = [...before.clips].sort((a, b) => a.rect.left - b.rect.left)[0];
    const rightMost = [...before.clips].sort((a, b) => b.rect.right - a.rect.right)[0];
    const dotL = overlay.dots.find((d) => d.side === 'left');
    const dotR = overlay.dots.find((d) => d.side === 'right');

    check(
        'M1 多选（2 块）后左右各一个控制点圆点',
        overlay.dots.length === 2 && dotL !== undefined && dotR !== undefined,
        `dots=${JSON.stringify(overlay.dots)}  块=${JSON.stringify(before.clips.map((c) => ({ id: c.id.slice(-6), rect: c.rect })))}`,
    );
    check(
        'M1b 左圆点 ≈ 最左块左缘外侧 10px / 右圆点 ≈ 最右块右缘外侧 10px',
        Math.abs((dotL?.cx ?? -999) - (leftMost.rect.left - DOT_OFFSET)) <= 3 &&
            Math.abs((dotR?.cx ?? -999) - (rightMost.rect.right + DOT_OFFSET)) <= 3,
        `左圆点 cx=${dotL?.cx} 期望 ${leftMost.rect.left - DOT_OFFSET}（最左块左缘 ${leftMost.rect.left} − 10）；` +
            `右圆点 cx=${dotR?.cx} 期望 ${rightMost.rect.right + DOT_OFFSET}（最右块右缘 ${rightMost.rect.right} + 10）`,
    );
    check(
        'M2 多选时常用功能浮条在場',
        overlay.bar !== null,
        `bar=${JSON.stringify(overlay.bar)}`,
    );

    /* ── 2. 拖左圆点（**右移** = 左缘内收）⇒ 两块都应被裁 ─────────────────── */
    const snapshot = (g) =>
        Object.fromEntries(
            g.clips.map((c) => [
                c.id,
                { startSec: +c.startSec.toFixed(4), lengthSec: +c.lengthSec.toFixed(4) },
            ]),
        );
    const b0 = snapshot(before);
    if (dotL) {
        await touch('touchStart', [{ id: 0, x: dotL.cx, y: dotL.cy }]);
        await sleep(80);
        for (let i = 1; i <= 5; i++) {
            await touch('touchMove', [{ id: 0, x: dotL.cx + (o.dx * i) / 5, y: dotL.cy }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(1200);
    }
    const afterL = await cdp.call(inPageGeometry);
    const a1 = snapshot(afterL);
    const changedL = Object.keys(b0).filter((id) => {
        const x = b0[id];
        const y = a1[id];
        return y && (Math.abs(y.startSec - x.startSec) > 1e-3 || Math.abs(y.lengthSec - x.lengthSec) > 1e-3);
    });
    check(
        'M3 拖左圆点右移 ⇒ **两块都**被裁切（批量）',
        changedL.length === 2 && a1 !== null,
        `before=${JSON.stringify(b0)}\n     after =${JSON.stringify(a1)}\n     变化块数=${changedL.length}（期望 2）`,
    );

    /* ── 3. 拖右圆点（**左移** = 右缘内收）⇒ 两块都应被裁 ─────────────────── */
    const overlay2 = await cdp.call(() => {
        const els = [...document.querySelectorAll('[data-hs-clip-control-point]')];
        const el = els.find((e) => e.getAttribute('data-hs-clip-control-point') === 'right');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
    });
    const b1 = a1;
    if (overlay2) {
        await touch('touchStart', [{ id: 0, x: overlay2.cx, y: overlay2.cy }]);
        await sleep(80);
        for (let i = 1; i <= 5; i++) {
            await touch('touchMove', [{ id: 0, x: overlay2.cx - (o.dx * i) / 5, y: overlay2.cy }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(1200);
    }
    const afterR = await cdp.call(inPageGeometry);
    const a2 = snapshot(afterR);
    const changedR = Object.keys(b1).filter((id) => {
        const x = b1[id];
        const y = a2[id];
        return y && (Math.abs(y.startSec - x.startSec) > 1e-3 || Math.abs(y.lengthSec - x.lengthSec) > 1e-3);
    });
    check(
        'M4 拖右圆点左移 ⇒ **两块都**被裁切（批量，另一侧）',
        changedR.length === 2,
        `before=${JSON.stringify(b1)}\n     after =${JSON.stringify(a2)}\n     变化块数=${changedR.length}（期望 2）  右圆点=${JSON.stringify(overlay2)}`,
    );

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== #2 多选批量探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
    console.error('探针异常：', e && e.message ? e.message : e);
    process.exit(2);
});
