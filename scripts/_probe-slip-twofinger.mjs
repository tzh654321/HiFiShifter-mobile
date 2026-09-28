#!/usr/bin/env node
/**
 * A3 验收：**双指长按并划动音频块 = Alt 拖动（slip）**
 * （规格 `docs/15` 表：音频块列 × `双指长按并划动` 行 = `调整音频相对于音频块的位置，相当于开了 Alt 拖动`；
 *   `docs/临时.xlsx` 第 8 格：`音频内容在块内平移，块位置/长度不变`）
 *
 * ── 建场景时踩过的三个坑（都在这里绕开了）──────────────────────────────────────
 * ① **直接导入的块无处可 slip**：块源窗口 = 整段素材（2s 素材 ⇒ 块 2s），内容已顶到
 *    媒体边界，`slipBoundaryAlignedSides` 的边界吸附会把它按回去 ⇒ 无论手势对不对
 *    读数都"没变化" = **假阴性**。所以先 `selectAll + split` 一分为二：左半的源窗口
 *    只有素材的前 40% ⇒ 窗口可在 [0, 1.18s] 内滑动，slip 才有可观测位移。
 * ② **`hifi:zoomTimelineFocus` 锚定播放头**（`anchorScreenX = 0`）⇒ 若先 seek 再缩放，
 *    `scrollLeft` 会变成 `playheadSec × pxPerSec`，块被推到内核容器**左外侧**（实测
 *    块左缘 x=72，而时间线区从 x=132 才开始）——手指落点在**轨道头列**上，什么都没发生。
 *    ⇒ 顺序必须是「先缩放（播放头还在 0）→ 再 seek → 再 split」。
 * ③ **触摸下「未选中块的划动 = 平移视野」**（规格 C 列：未选中⇒平移视野、已选中⇒拖动块）
 *    ⇒ 手势前必须**先单击选中目标块**，否则单指拖动只会平移视野。
 *
 * ── 三条用例（各自重建场景）───────────────────────────────────────────────────
 *   C 对照     单指拖块中部 ⇒ **移动块**（start/length 变、源窗口不变）
 *              —— 校验"驱动 + 命中 + 选中"这条链路本身是活的，否则后面的"没变化"无法解释。
 *   A 内核通道  页面内合成 `PointerEvent`（`altKey:true`）拖块中部 ⇒ 应当 slip。
 *              绕开手势层与原生触摸 ⇒ 单看内核的 slip 通道是否可用。
 *   B 真手势    真实触摸：两指按在块中部 → 不动 700ms（越过 500ms 长按阈值）→ 两指一起横滑
 *              ⇒ 应当 slip。覆盖「手势层 + 原生触摸」两段。
 *
 * 结论读法：A ✅ / B 🔴 ⇒ 内核通道没问题，坏在虚拟 Alt 的时机或原生触摸；A 🔴 ⇒ 内核通道没接上。
 *
 * 用法：node scripts/_probe-slip-twofinger.mjs --serial 221deeb [--dx 60] [--hold 700]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, wav: 'D:\\Temp\\hs-tone.wav', dx: 60, hold: 700 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
        else if (a === '--dx') o.dx = Number(argv[++i]);
        else if (a === '--hold') o.hold = Number(argv[++i]);
    }
    return o;
}

/**
 * 页面内：读几何 + 权威工程状态。
 *
 * 🔴 只能读**后端**状态：APK 是生产构建，`main.tsx` 挂 `__hsStore` 的代码在
 * `import.meta.env.DEV` 之下 ⇒ 真机上没有 store 钩子，拖拽期间的"乐观预览"（只写
 * redux）读不到。因此所有断言都取**抬手提交后**的值。
 */
function inPageGeometry() {
    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    return invoke('get_timeline_state').then((state) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        if (!vp) return { error: 'no-viewport' };
        const tracks = state.tracks || [];
        const trackOrder = tracks.map((t) => t.id);
        const norm = (raw) => ({
            id: raw.id,
            startSec: raw.start_sec,
            lengthSec: raw.length_sec,
            sourceStartSec: raw.source_start_sec,
            sourceEndSec: raw.source_end_sec,
            rate: raw.clip_playback_rate ?? raw.playback_rate,
        });
        const all = [...(state.clips || [])]
            .sort((a, b) => {
                const ra = trackOrder.indexOf(a.track_id) - trackOrder.indexOf(b.track_id);
                return ra !== 0 ? ra : a.start_sec - b.start_sec;
            })
            .map(norm);
        if (all.length === 0) return { clips: 0, allClips: [], viewport: vp, playheadSec: state.playhead_sec };
        const clip = all[0];
        const c = vp.containerRect;
        /* 行矩形取**渲染真值** `[data-hs-track-row]`（子母轨会插在父之后，按"扁平下标 ×
           行高"算 y 会落到别的行 —— 真机上实际踩过）。 */
        const rawRow = (state.clips || []).find((x) => x.id === clip.id);
        const rowEl = document.querySelector(`[data-hs-track-row="${rawRow.track_id}"]`);
        const rowRect = rowEl ? rowEl.getBoundingClientRect() : null;
        const rowHeightPx = rowRect ? rowRect.height : vp.rowHeight;
        const topPx = rowRect ? rowRect.top : c.top - vp.scrollTop;
        const clipHeight = Math.max(1, rowHeightPx - 2);
        const leftPx = c.left + clip.startSec * vp.pxPerSec - vp.scrollLeft;
        const widthPx = Math.max(1, clip.lengthSec * vp.pxPerSec);
        const rect = {
            left: Math.round(leftPx),
            right: Math.round(leftPx + widthPx),
            top: Math.round(topPx),
            height: Math.round(clipHeight),
        };
        return {
            clips: all.length,
            allClips: all,
            playheadSec: state.playhead_sec,
            viewport: {
                pxPerSec: vp.pxPerSec,
                rowHeight: vp.rowHeight,
                scrollLeft: vp.scrollLeft,
                containerRect: c,
            },
            clip,
            clipRect: rect,
            /* 「在视口内」= 块的**可见部分**确实落在内核容器里（不只是数学上不越界）。 */
            visible:
                rect.right > c.left + 2 &&
                rect.left < c.left + c.width - 2 &&
                rect.top >= c.top - 1 &&
                rect.top + rect.height <= c.top + c.height + 1,
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

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const tap = async (x, y, hold = 60) => {
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(360);
    };

    /* 探针之间必须互相独立：先停播（播放态会 30Hz 覆写 playhead 并改提交路径）。 */
    await cdp.call(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.ariaLabel === '停止');
        if (btn) btn.click();
    });
    await sleep(600);

    /** 清空工程（走时间轴自己的编辑通道，不绕过面板改后端）。 */
    async function clearAll() {
        for (let guard = 0; guard < 6; guard++) {
            const before = await cdp.call(inPageGeometry);
            if (!before.clips) return;
            await cdp.call(() => {
                const fire = (op) =>
                    window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
                fire('selectAll');
                fire('delete');
            });
            await sleep(900);
        }
    }

    /** 点内核容器里的空白（归属编辑表面）——y 避开容器底部 120px（实测底部有遮挡带）。 */
    async function tapBlank() {
        const g = await cdp.call(inPageGeometry);
        const c = g.viewport.containerRect;
        await tap(Math.round(c.left + c.width * 0.6), Math.round(c.top + c.height - 120));
    }

    /** 把**总内容宽度**缩到容器宽度的指定比例（缩放锚定播放头 ⇒ 播放头在 0 时 scrollLeft 保持 0）。 */
    async function zoomContentTo(ratio) {
        for (let i = 0; i < 8; i++) {
            const g = await cdp.call(inPageGeometry);
            const endSec = Math.max(...g.allClips.map((x) => x.startSec + x.lengthSec));
            const wantPxPerSec = (g.viewport.containerRect.width * ratio) / Math.max(0.001, endSec);
            const factor = Math.min(8, Math.max(0.125, wantPxPerSec / g.viewport.pxPerSec));
            if (Math.abs(factor - 1) < 0.02) break;
            await cdp.call(
                (f) => window.dispatchEvent(new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } })),
                factor,
            );
            await sleep(220);
        }
    }

    /** 点拍数栏 seek（`split` 是在**播放头处**切）。 */
    async function seekTo(sec) {
        const g = await cdp.call(inPageGeometry);
        const c = g.viewport.containerRect;
        const x = Math.round(c.left + sec * g.viewport.pxPerSec - g.viewport.scrollLeft);
        const y = await cdp.call(() => {
            const c2 = window.__hsViewport().containerRect;
            const r = document.querySelector('[data-hs-time-ruler="timeline"]');
            if (r) {
                const rr = r.getBoundingClientRect();
                return Math.round(rr.top + rr.height / 2);
            }
            return Math.round(c2.top - 24);
        });
        await tap(x, y);
    }

    /**
     * 必要时把 `scrollLeft` 拉回 0（**底部遮挡带以上**的空白区横拖：实测该处才生效；
     * 贴近容器底 40px 的位置拖不动）。
     */
    async function panToStart() {
        for (let i = 0; i < 30; i++) {
            const g = await cdp.call(inPageGeometry);
            if (g.viewport.scrollLeft <= 1) return g;
            const c = g.viewport.containerRect;
            const y = Math.round(c.top + c.height - 120);
            const x0 = Math.round(c.left + 12);
            await touch('touchStart', [{ id: 0, x: x0, y }]);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [
                    { id: 0, x: Math.round(x0 + ((c.width - 24) * k) / 6), y },
                ]);
                await sleep(28);
            }
            await touch('touchEnd', []);
            await sleep(260);
        }
        return cdp.call(inPageGeometry);
    }

    /** 建场景：清空 → 导入 → 缩放（播放头 0）→ seek 40% → split ⇒ 得到源窗口小于素材的半块。 */
    async function buildScene(label) {
        await clearAll();
        const b64 = readFileSync(o.wav).toString('base64');
        await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), label, b64, 0);
        await sleep(1400);
        await tapBlank();
        await zoomContentTo(0.85);
        let geo = await cdp.call(inPageGeometry);
        if (geo.clips !== 1) throw new Error(`导入后应有 1 个块，实得 ${geo.clips}`);
        await seekTo(geo.clip.lengthSec * 0.4);
        await cdp.call(() => {
            const fire = (op) =>
                window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('split');
        });
        await sleep(1300);
        geo = await cdp.call(inPageGeometry);
        if (geo.clips !== 2) throw new Error(`split 后应有 2 个块，实得 ${geo.clips}`);
        if (!geo.visible || geo.viewport.scrollLeft > 1) geo = await panToStart();
        if (!geo.visible) throw new Error(`目标块不在视口内：${JSON.stringify(geo.clipRect)} container=${JSON.stringify(geo.viewport.containerRect)}`);
        return geo;
    }

    /**
     * 选中目标块（**必须**：触摸下"未选中块的划动 = 平移视野"）+ 找一个**不被浮层遮住**的落点。
     *
     * 单击块 = 选中并弹出常用操作条；操作条可能压在块上 ⇒ 在块体内取若干候选点，
     * 选第一个"最上层元素不是按钮/浮层"的点，并把元素栈一起报回来（便于判读）。
     */
    async function selectAndPick() {
        let geo = await cdp.call(inPageGeometry);
        if (!geo.clipRect) throw new Error(`取不到目标块矩形（clips=${geo.clips}）`);
        const c = geo.clipRect;
        const header = 18;
        const bodyTop = c.top + header;
        const bodyH = Math.max(1, c.height - header);
        const xs = [c.left + (c.right - c.left) * 0.5, c.left + (c.right - c.left) * 0.35, c.left + (c.right - c.left) * 0.65];
        const ys = [Math.round(bodyTop + bodyH * 0.55), Math.round(bodyTop + bodyH * 0.3), Math.round(bodyTop + bodyH * 0.8)];
        /* 先单击块中部（完成选中）。 */
        await tap(Math.round(xs[0]), ys[0], 60);
        geo = await cdp.call(inPageGeometry);
        const picked = await cdp.call(
            (xsIn, ysIn) => {
                const at = (x, y) => {
                    const stack = document.elementsFromPoint(x, y);
                    const top = stack[0];
                    return {
                        x,
                        y,
                        top: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null,
                        stack: stack.slice(0, 4).map((e) => `${e.tagName}.${String(e.className).slice(0, 26)}`),
                    };
                };
                const cand = [];
                for (const y of ysIn) for (const x of xsIn) cand.push(at(Math.round(x), y));
                const ok = cand.find((p) => p.top && !/^(BUTTON|INPUT|A)$/.test(p.top.split('.')[0]));
                return { cand, ok: ok || cand[0] };
            },
            xs,
            ys,
        );
        return { geo, picked };
    }

    /**
     * 按 **id** 读目标块。
     *
     * 🔴 不能按序号（`allClips[0]`）：拖动的块一旦越过邻居的 start，排序就变，
     * 于是"before 是左块、after 是右块" ⇒ Δ 全是假的（第一版就这么误判了 C 对照）。
     */
    async function readById(id) {
        const g = await cdp.call(inPageGeometry);
        return g.allClips.find((c) => c.id === id) ?? null;
    }
    /** 读「触屏虚拟修饰键」覆盖位（内核 host 挂的验收钩子；读不到返回 null）。 */
    const mods = () =>
        cdp.call(() => (window.__hsTouchModifiers ? { ...window.__hsTouchModifiers } : null));

    const TRACKED = ['startSec', 'lengthSec', 'sourceStartSec', 'sourceEndSec'];
    const diff = (a, b) => {
        const d = {};
        for (const k of TRACKED) {
            const delta = +((b[k] ?? 0) - (a[k] ?? 0)).toFixed(4);
            if (Math.abs(delta) > 1e-4) d[k] = delta;
        }
        return d;
    };
    /** 等落库（提交是异步的：面板 → thunk → 后端 → 再读）。 */
    async function waitCommit(before, ms = 3500) {
        const t0 = Date.now();
        let last = before;
        while (Date.now() - t0 < ms) {
            last = (await readById(before.id)) ?? before;
            if (TRACKED.some((k) => Math.abs((last[k] ?? 0) - (before[k] ?? 0)) > 1e-4)) return last;
            await sleep(150);
        }
        return last;
    }
    const isSlip = (d) =>
        (d.sourceStartSec !== undefined || d.sourceEndSec !== undefined) &&
        d.startSec === undefined &&
        d.lengthSec === undefined;
    const isMove = (d) => d.startSec !== undefined || d.lengthSec !== undefined;

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /* ── C 对照：单指拖块中部 = 移动块 ───────────────────────────────────── */
    {
        await buildScene(`hs-slip-C-${Date.now()}.wav`);
        const { geo, picked } = await selectAndPick();
        const before = await readById(geo.clip.id);
        const p = picked.ok;
        await touch('touchStart', [{ id: 0, x: p.x, y: p.y }]);
        await sleep(60);
        for (let i = 1; i <= 5; i++) {
            await touch('touchMove', [{ id: 0, x: p.x + (o.dx * i) / 5, y: p.y }]);
            await sleep(40);
        }
        await touch('touchEnd', []);
        await sleep(500);
        const after = await waitCommit(before);
        const d = diff(before, after);
        check(
            'C 对照：单指拖块中部 ⇒ 移动块（start 变、源窗口不变）',
            isMove(d) && d.sourceStartSec === undefined,
            `Δ=${JSON.stringify(d)}  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}\n     落点=${JSON.stringify(p)}  场景=${JSON.stringify(geo.clipRect)} scrollLeft=${Math.round(geo.viewport.scrollLeft)} pxPerSec=${Math.round(geo.viewport.pxPerSec)}`,
        );
    }

    /* ── A 内核通道：合成 altKey（绕开手势层与原生触摸）──────────────────── */
    {
        const geo = await buildScene(`hs-slip-A-${Date.now()}.wav`);
        const { picked } = await selectAndPick();
        const targetId = geo.clip.id;
        const p = picked.ok;
        for (const dx of [-o.dx, o.dx]) {
            const b = await readById(targetId);
            await cdp.call(
                async (dxIn, px, py) => {
                    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                    const target = document.elementFromPoint(px, py) ?? document.body;
                    const mk = (type, id, x, y, buttons) =>
                        new PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            pointerType: 'touch',
                            pointerId: id,
                            isPrimary: true,
                            button: type === 'pointerdown' ? 0 : -1,
                            buttons,
                            /* 🔑 虚拟 Alt：内核 `dragModifiersOf` 读 `event.altKey || touchModifiers.alt`
                               ⇒ 合成事件直接给 `altKey` 就只验内核的 slip 通道。 */
                            altKey: true,
                            clientX: x,
                            clientY: y,
                        });
                    target.dispatchEvent(mk('pointerdown', 31, px, py, 1));
                    await wait(60);
                    for (let i = 1; i <= 5; i++) {
                        target.dispatchEvent(mk('pointermove', 31, px + (dxIn * i) / 5, py, 1));
                        await wait(40);
                    }
                    target.dispatchEvent(mk('pointerup', 31, px + dxIn, py, 0));
                    await wait(300);
                },
                dx,
                p.x,
                p.y,
            );
            await sleep(400);
            const after = await waitCommit(b);
            const d = diff(b, after);
            if (Object.keys(d).length > 0) {
                check(
                    'A 内核通道：合成 altKey 拖块中部 ⇒ slip（源窗口变、start/length 不变）',
                    isSlip(d),
                    `Δ=${JSON.stringify(d)}（dx=${dx}）  before=${JSON.stringify(b)}  after=${JSON.stringify(after)}\n     落点=${JSON.stringify(p)}`,
                );
                break;
            }
            if (dx === o.dx) {
                check(
                    'A 内核通道：合成 altKey 拖块中部 ⇒ slip（源窗口变、start/length 不变）',
                    false,
                    `两个方向都没变化（dx=${-o.dx} / ${o.dx}）；clip=${JSON.stringify(await readById(targetId))}  落点=${JSON.stringify(p)}`,
                );
            }
        }
    }

    /* ── B 真手势：两指长按 700ms 后一起横滑 ───────────────────────────── */
    {
        const geo = await buildScene(`hs-slip-B-${Date.now()}.wav`);
        const { picked } = await selectAndPick();
        const targetId = geo.clip.id;
        const p = picked.ok;
        for (const dx of [-o.dx, o.dx]) {
            const before = await readById(targetId);
            const p0 = { id: 0, x: p.x - 18, y: p.y };
            const p1 = { id: 1, x: p.x + 18, y: p.y };
            const trace = {};
            await touch('touchStart', [p0]);
            await sleep(90);
            trace.afterFinger0 = await mods();
            await touch('touchStart', [p0, p1]);
            await sleep(120);
            trace.afterFinger1 = await mods();
            await sleep(o.hold); /* 越过手势层的 500ms 长按阈值 */
            trace.afterHold = await mods();
            for (let i = 1; i <= 5; i++) {
                const d2 = (dx * i) / 5;
                await touch('touchMove', [
                    { id: 0, x: p0.x + d2, y: p0.y },
                    { id: 1, x: p1.x + d2, y: p1.y },
                ]);
                await sleep(45);
                if (i === 1) trace.afterMove1 = await mods();
            }
            trace.afterMoveAll = await mods();
            await touch('touchEnd', []);
            await sleep(500);
            trace.afterUp = await mods();
            const after = await waitCommit(before);
            const d = diff(before, after);
            if (Object.keys(d).length > 0) {
                check(
                    'B 真手势：双指长按 700ms + 一起横滑 ⇒ slip',
                    isSlip(d),
                    `Δ=${JSON.stringify(d)}（dx=${dx}）  before=${JSON.stringify(before)}  after=${JSON.stringify(after)}\n     两指=${JSON.stringify([p0, p1])}  修饰键轨迹=${JSON.stringify(trace)}`,
                );
                break;
            }
            if (dx === o.dx) {
                check(
                    'B 真手势：双指长按 700ms + 一起横滑 ⇒ slip',
                    false,
                    `两个方向都没变化；clip=${JSON.stringify(before)}   两指=${JSON.stringify([p0, p1])}\n     修饰键轨迹=${JSON.stringify(trace)}`,
                );
            }
        }
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== A3 探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
