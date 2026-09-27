#!/usr/bin/env node
/**
 * ⑦ 控制点「长按并划动」两段式验收（规格 `docs/15` E 列 / `docs/临时.xlsx` 行 6-E）：
 *
 *   上划后再横滑 = 调整淡入淡出时长（左控制点 = 淡入，右控制点 = 淡出）
 *   下划后再横滑 = 调整变速缩放（等价电脑版 Alt 拖边缘）
 *
 * 顺带验收同一列「长按」行（行 5-E）的提示：**其上方出现淡入/淡出图标、
 * 下方出现变速缩放图标**（浮层 `[data-hs-edge-longpress-hint]`）。
 *
 * 【为什么必须在同一个触摸序列里做】
 * 判定是「按住满 500ms → 再按纵向位移定型」：分两次触摸的话，第一次抬手就把
 * 长按候选清掉了，第二次只是普通边缘拖拽（= 裁切）。
 *
 * 【命中点怎么算】
 * 左右边缘（`left-edge` / `right-edge`）在竖直方向只占 clip 的**下部**：
 *   localY ∈ [header + reserve, clipHeight − 12)   （reserve = max(14, body/3)）
 * 上下的其余部分是淡变角（横帽 / 竖条）与 SnapOffset 三角握把，按在那里会落到
 * 别的分区。所以 y 取该带的中点，x 取距 clip 边缘 5px（边缘带宽 10px）。
 *
 * 【为什么先缩小】
 * 首次进入时 pxPerSec 可能高达 3500（≈1px = 0.0003s），一次 60px 的手势只带来
 * 0.017s 的淡变，且会被网格吸附吞掉。先经 `hifi:zoomTimelineFocus` 缩到
 * pxPerSec ≈ 100（2s 素材 ≈ 200px，左右两个控制点都在屏内），位移才有意义。
 *
 * 用法：node scripts/_probe-edge-drag.mjs --serial emulator-5554
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = {
        serial: 'emulator-5554',
        port: 9222,
        wav: 'D:\\Temp\\hs-tone.wav',
        holdMs: 700,
        /** 长按保持期间抓一张真机截图（提示图标的**视觉**证据：DOM 断言看不到遮挡 / 裁切）。 */
        shot: '',
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
        else if (a === '--hold') o.holdMs = Number(argv[++i]);
        else if (a === '--shot') o.shot = argv[++i];
    }
    return o;
}

/**
 * 真机截图（宿主机侧）。
 *
 * ⚠️ **不能**用 `adb exec-out screencap -p > x.png`：PowerShell 的重定向会把二进制
 * 当文本写坏（PNG 变 UTF-16）。必须先落到设备上再 `adb pull`。
 *
 * @param serial 设备序列号。
 * @param dest 宿主机目标路径。
 * @returns 无返回值（失败时抛错）。
 */
function screencap(serial, dest) {
    execSync(`adb -s ${serial} shell screencap -p /sdcard/hs-shot.png`);
    execSync(`adb -s ${serial} pull /sdcard/hs-shot.png "${dest}"`, { stdio: 'ignore' });
}

/** 页面内：Tauri 的工程状态是 **snake_case**（与 redux 的 camelCase 不同名）。 */
function inPageGeometry() {
    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    return invoke('get_timeline_state').then((state) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        if (!vp) return { error: 'no-viewport' };
        const clips = state.clips || [];
        const tracks = state.tracks || [];
        if (clips.length === 0) return { clips: 0, viewport: vp };
        // 取**第一条轨道上最靠左**的 clip：控制点必须落在可视区内才好按。
        const trackOrder = tracks.map((t) => t.id);
        const ordered = [...clips].sort((a, b) => {
            const ra = trackOrder.indexOf(a.track_id) - trackOrder.indexOf(b.track_id);
            return ra !== 0 ? ra : a.start_sec - b.start_sec;
        });
        const raw = ordered[0];
        const clip = {
            id: raw.id,
            name: raw.name,
            startSec: raw.start_sec,
            lengthSec: raw.length_sec,
            fadeInSec: raw.fade_in_sec ?? 0,
            fadeOutSec: raw.fade_out_sec ?? 0,
            autoFadeInSec: raw.auto_fade_in_sec ?? 0,
            autoFadeOutSec: raw.auto_fade_out_sec ?? 0,
            sourceStartSec: raw.source_start_sec,
            sourceEndSec: raw.source_end_sec,
            playbackRate: raw.playback_rate,
            clipPlaybackRate: raw.clip_playback_rate,
        };
        const rowIndex = trackOrder.indexOf(raw.track_id);
        const c = vp.containerRect;
        /* ── 行矩形必须取**渲染真值**，不能按扁平下标 × rowHeight 推算 ──────────
           `state.tracks` 是**扁平列表**，而时间轴按"父 → 其子 → 下一个父"渲染
           （子母轨会被插入父之后）；真机上正是靠这个顺序差异，让"下标 × 行高"算出的
           y 落到了**别的行**上（探针于是在块外的空白处滑动：长按无提示、拖动无反应，
           看起来像"功能没实现"）。轨道头 DOM 行 `[data-hs-track-row=<trackId>]` 的
           矩形就是渲染真值，顺带把行高也校准了（真机行高会随可见轨道数变化）。 */
        const rowEl = document.querySelector(`[data-hs-track-row="${raw.track_id}"]`);
        const rowRect = rowEl ? rowEl.getBoundingClientRect() : null;
        const rowHeightPx = rowRect ? rowRect.height : vp.rowHeight;
        const topPx = rowRect ? rowRect.top : c.top + rowIndex * vp.rowHeight - vp.scrollTop;
        const clipHeight = Math.max(1, rowHeightPx - 2);
        const header = 18; /* CLIP_HEADER_HEIGHT */
        const body = Math.max(1, clipHeight - header);
        const reserve = Math.max(14, Math.round(body / 3));
        const edgeTop = header + reserve;
        const edgeBottom = Math.max(edgeTop + 1, clipHeight - 12); /* 避开 SnapOffset 握把 */
        const localY = Math.round((edgeTop + edgeBottom) / 2);
        const leftPx = c.left + clip.startSec * vp.pxPerSec - vp.scrollLeft;
        const widthPx = Math.max(1, clip.lengthSec * vp.pxPerSec);
        return {
            clips: clips.length,
            playheadSec: state.playhead_sec,
            bpm: state.bpm,
            viewport: {
                pxPerSec: vp.pxPerSec,
                rowHeight: vp.rowHeight,
                scrollLeft: vp.scrollLeft,
                scrollTop: vp.scrollTop,
                containerRect: c,
            },
            clip,
            hit: {
                rowSource: rowRect ? 'dom-row' : 'arithmetic',
                rowIndex,
                rowHeightPx: Math.round(rowHeightPx),
                leftEdge: { x: Math.round(leftPx + 5), y: Math.round(topPx + localY) },
                rightEdge: { x: Math.round(leftPx + widthPx - 5), y: Math.round(topPx + localY) },
                clipRect: {
                    left: Math.round(leftPx),
                    right: Math.round(leftPx + widthPx),
                    top: Math.round(topPx),
                    height: Math.round(clipHeight),
                },
                inViewport:
                    leftPx >= c.left - 1 &&
                    leftPx + widthPx <= c.left + c.width + 1 &&
                    topPx >= c.top - 1 &&
                    topPx + clipHeight <= c.top + c.height + 1,
                bands: { header, reserve, edgeBand: [edgeTop, edgeBottom], localY },
            },
        };
    });
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    /* 先确保**停止播放**：⑧（拍数栏双击）会起播并留着播，若上一套件刚跑完 ⑧，
       本套件就工作在"播放中"——而淡变/裁切的提交路径在播放态与停止态不同
       （面板按阶段挡 seek、引擎 30Hz 覆写 playhead），实测会连带多条失败。
       探针之间必须互相独立，这条是"从别套件接着跑"的必备前置。 */
    await cdp.call(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.ariaLabel === '停止');
        if (btn) btn.click();
    });
    await sleep(600);

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    /** 轻点时间线上的一块空白（同时完成两件事：归属编辑表面 + 给播放头一个落点）。 */    async function tapBlank() {
        const g = await cdp.call(inPageGeometry);
        const c = g.viewport.containerRect;
        const x = Math.round(c.left + c.width / 2);
        const y = Math.round(c.top + c.height - 40);
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(400);
        return { x, y };
    }

    /**
     * 把工程清成「空」，再导入一个**固定 2 秒**的新块。
     *
     * 【为什么必须清】⑦b 的变速会**永久改变块长**（实测一次下划把 2s 拉成 7.5s），
     * 而且拉伸会**按同一比例缩放淡变长度**（0.614s → 2.33s）。不清的话第二次运行
     * 就在"上一条用例的残骸"上测量：块超宽 ⇒ 控制点在屏外、同轨多块 ⇒ 命中落进
     * 重叠区被改写 —— 结论全是假阴暗（第一版就是这样：几何对了、数值却全是上一轮
     * 留下的）。
     *
     * 清理由时间轴自己的编辑通道完成（`hifi:timelineEditOp` 的 `selectAll` +
     * `delete`），与 UI 的「全选 → 删除」逐字同路，不绕过面板直接改后端状态。
     */
    async function resetAndImport(label) {
        for (let guard = 0; guard < 6; guard++) {
            const before = await cdp.call(inPageGeometry);
            if (!before.clips) break;
            await cdp.call(() => {
                const fire = (op) =>
                    window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
                fire('selectAll');
                fire('delete');
            });
            await sleep(900);
            const after = await cdp.call(inPageGeometry);
            console.log(`▸ 清理：clips ${before.clips} → ${after.clips}`);
            if (!after.clips) break;
        }
        const b64 = readFileSync(o.wav).toString('base64');
        await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), label, b64, 0);
        await sleep(1400);
        let g = await cdp.call(inPageGeometry);
        if (g.clips !== 1) {
            // 兜底：清不干净就别测了——多块同轨会让命中落进重叠区，结论不可信。
            throw new Error(`清理/导入后工程里应恰有 1 个块，实得 ${g.clips} 个`);
        }
        return g;
    }

    // 先归属编辑表面（见下方注释），再清理、导入。
    await tapBlank();
    let geo = await resetAndImport(`hs-edge-${Date.now()}.wav`);
    if (!geo || geo.error) throw new Error('几何读取失败：' + JSON.stringify(geo));
    console.log(
        `▸ 导入后：pxPerSec=${Math.round(geo.viewport.pxPerSec)} 块宽=${geo.hit.clipRect.right - geo.hit.clipRect.left}px 视口宽=${Math.round(geo.viewport.containerRect.width)}`,
    );

    // 缩放：让**整个块**进视口（头尾两个控制点都要按得到）。
    //
    // ⚠️ 缩放监听按「活动编辑表面」裁决（`getActiveSurface() === "timeline"`，见
    // `focusRouting`），而表面归属只由 `[data-hs-surface]` 上的 pointerdown 更新
    // ——第一版直接派发事件，`activeSurface` 还是 null ⇒ 缩放被整条丢弃
    // （pxPerSec 从 3557 一动不动，尾控制点始终在屏外）。
    const primed = await cdp.call(() => Boolean(document.querySelector('[data-hs-surface="timeline"]')));
    const { x: cx, y: cy } = await tapBlank();
    console.log(`▸ 时间线表面 [data-hs-surface="timeline"]：${primed}；已轻点 (${cx},${cy}) 以归属焦点`);

    /**
     * 把横向滚动**拉回 0**（内容跟手，右划 = scrollLeft 变小）。
     *
     * 【为什么非要回到 0】缩放是**锚定播放头**的（`playheadZoomEnabled`，
     * `anchorScreenX = 0`）：只要 scrollLeft 非 0，缩放就会把块起点推到视口左外侧
     * （实测 left = −296 ⇒ 两个控制点全在屏外，④⑦ 全部假阴暗）。scrollLeft 的
     * 最小值就是 0，而块起点在 0s ⇒ 拉回 0 就等于"块左缘对齐容器左缘"。
     */
    async function panToStart() {
        for (let i = 0; i < 40; i++) {
            const g = await cdp.call(inPageGeometry);
            if (!g || !g.viewport) return g;
            if (g.viewport.scrollLeft <= 1) return g;
            const c = g.viewport.containerRect;
            const y = Math.round(c.top + c.height - 40);
            await touch('touchStart', [{ id: 0, x: Math.round(c.left + 12), y }]);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [
                    { id: 0, x: Math.round(c.left + 12 + ((c.width - 24) * k) / 6), y },
                ]);
                await sleep(28);
            }
            await touch('touchEnd', []);
            await sleep(260);
        }
        return cdp.call(inPageGeometry);
    }

    geo = await panToStart();
    for (let i = 0; i < 24; i++) {
        const widthPx = geo.hit.clipRect.right - geo.hit.clipRect.left;
        const target = geo.viewport.containerRect.width * 0.8;
        if (Math.abs(widthPx - target) <= target * 0.3) break;
        // 一次到位：`resolveHorizontalWheelZoom` 自己会钳到 [min, max]。
        const factor = Math.min(8, Math.max(0.125, target / widthPx));
        await cdp.call(
            (f) => window.dispatchEvent(new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } })),
            factor,
        );
        await sleep(200);
        geo = await cdp.call(inPageGeometry);
    }
    // 缩放会（按播放头锚定）把视口推走 ⇒ 再拉回 0 一次，块左缘才对齐容器左缘。
    geo = await panToStart();
    console.log(
        `▸ 缩放后：pxPerSec=${geo.viewport.pxPerSec.toFixed(1)} scrollLeft=${Math.round(geo.viewport.scrollLeft)} 块=${JSON.stringify(geo.hit.clipRect)} 在视口内=${geo.hit.inViewport}（行矩形取自${geo.hit.rowSource}，行高 ${geo.hit.rowHeightPx}）`,
    );
    console.log('▸ 命中分区带：' + JSON.stringify(geo.hit.bands));

    /**
     * 每条用例前重新取一次几何：变速会**改块长**（2s → 7.5s），上一条用例算出的
     * 尾控制点坐标在下一段就已经过时（偏到屏外），按过去只会得到"什么都没发生"。
     * 顺便在块不再完整可见时重新缩放 / 拉回起点。
     */
    /**
     * 把块的水平宽度按**视口宽度的固定比例**缩放（确定性：与"当前是多少"无关），
     * 然后把视口拉回起点。
     *
     * 【为什么要确定一个比例】所有"位移 → 秒"的断言都以 `pxPerSec` 为准，
     * 而 `pxPerSec` 是**上一条用例留下的**（变速会改块长 ⇒ 缩放目标跟着漂）。
     * 把它钉在比例上，每条用例的位移读数才是可复现的。
     *
     * ⚠️ 比例不能太大：内核在指针进入容器左右 **32px** 时启动拖拽边缘自动滚屏
     * （`DRAG_EDGE_SCROLL_BAND_PX`，速度上限 `720 × 1.5` px/s）。0.6 ⇒ 块的右端
     * 距容器右缘 ≥ 48px，任何 ≤40px 的横向位移都不会踩进自动滚屏带。
     *
     * @param ratio 目标宽度 / 视口宽度。
     * @returns 更新后的几何。
     */
    async function fitTo(ratio) {
        for (let i = 0; i < 24; i++) {
            const widthPx = geo.hit.clipRect.right - geo.hit.clipRect.left;
            const target = geo.viewport.containerRect.width * ratio;
            if (Math.abs(widthPx - target) <= 3) break;
            const factor = Math.min(8, Math.max(0.125, target / widthPx));
            await cdp.call(
                (f) =>
                    window.dispatchEvent(
                        new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } }),
                    ),
                factor,
            );
            await sleep(200);
            geo = await cdp.call(inPageGeometry);
        }
        geo = await panToStart();
        return geo;
    }

    async function refit() {
        let g = await cdp.call(inPageGeometry);
        if (!g || g.error) throw new Error('几何读取失败：' + JSON.stringify(g));
        geo = g;
        if (!g.hit.inViewport) return fitTo(0.6);
        return geo;
    }

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /**
     * 一次「长按 → 纵向定型 → 横滑 → 抬手」的完整触摸序列。
     *
     * @param from 起点（控制点）。
     * @param dyLock 定型方向：负 = 上划（淡入淡出），正 = 下划（变速）。
     * @param dx 定型后的横向位移。
     */
    async function twoStage(from, dyLock, dx, onMid = null) {
        const lock = { id: 0, x: from.x, y: from.y + dyLock };
        await touch('touchStart', [{ id: 0, x: from.x, y: from.y }]);
        await sleep(o.holdMs); // 越过 500ms 长按阈值
        const hintDuringHold = await cdp.call(() => {
            const el = document.querySelector('[data-hs-edge-longpress-hint]');
            if (!el) return null;
            const pills = [...el.querySelectorAll('[data-hs-edge-hint]')].map((p) => ({
                kind: p.getAttribute('data-hs-edge-hint'),
                text: (p.textContent || '').trim(),
                top: Math.round(p.getBoundingClientRect().top),
            }));
            return { side: el.getAttribute('data-hs-edge-side'), pills };
        });
        if (o.shot) {
            // 截图必须在**手指仍按着**的时候抓：提示只存在于长按保持期间。
            screencap(o.serial, o.shot);
            console.log(`▸ 长按保持中的截图：${o.shot}`);
        }
        // 纵向定型（分两步，模拟手指划动而不是瞬移）
        await touch('touchMove', [{ id: 0, x: from.x, y: from.y + dyLock / 2 }]);
        await sleep(40);
        await touch('touchMove', [lock]);
        await sleep(60);
        // 横滑（从 0 起算，按 4 步走）
        const steps = 4;
        for (let i = 1; i <= steps; i++) {
            await touch('touchMove', [{ id: 0, x: from.x + (dx * i) / steps, y: lock.y }]);
            await sleep(45);
        }
        // 按住时的读数（**抬手前**）：用来分辨"预览就错了"还是"提交时才错"。
        const midDrag = onMid ? await onMid() : null;
        const hintAfterLock = await cdp.call(() =>
            Boolean(document.querySelector('[data-hs-edge-longpress-hint]')),
        );
        await touch('touchEnd', []);
        await sleep(500);
        return { hintDuringHold, hintAfterLock, midDrag };
    }

    const readClip = async () => (await cdp.call(inPageGeometry)).clip;
    const px = () => geo.viewport.pxPerSec;

    const TRACKED_KEYS = [
        'startSec',
        'lengthSec',
        'fadeInSec',
        'fadeOutSec',
        'sourceStartSec',
        'sourceEndSec',
        'clipPlaybackRate',
    ];

    /**
     * 等落库：手势抬手后**提交是异步的**（面板 → thunk → 后端 → `get_timeline_state`）。
     * 实测只睡 500ms 会读到上一轮的值 ⇒ 每一条断言都变成"在残骸上判断"
     * （第一版 ⑦a 因此报「fadeIn 0 → 0」，而下一段的 before 却已是新值）。
     *
     * @param before 手势前的读数。
     * @returns 出现**任一**被跟踪字段变化后的读数；超时未变则返回最后一次读数。
     */
    async function waitCommit(before, ms = 3500) {
        const t0 = Date.now();
        let last = before;
        while (Date.now() - t0 < ms) {
            last = await readClip();
            const changed = TRACKED_KEYS.some(
                (k) => Math.abs((last[k] ?? 0) - (before[k] ?? 0)) > 1e-6,
            );
            if (changed) return last;
            await sleep(150);
        }
        return last;
    }

    // ── ⑦a 左控制点：上划 + 右横滑 = 淡入时长变长 ─────────────────────────
    {
        await refit();
        const before = await readClip();
        const dx = 60;
        const seq = await twoStage(geo.hit.leftEdge, -34, dx);
        const after = await waitCommit(before);
        const expected = dx / px();
        const delta = (after.fadeInSec ?? 0) - (before.fadeInSec ?? 0);
        check(
            '⑦a 左控制点·上划后横滑 = 调淡入时长',
            delta > expected * 0.4 && delta > 0.01,
            `fadeInSec ${before.fadeInSec} → ${after.fadeInSec}（期望 +≈${expected.toFixed(3)}s，实得 +${delta.toFixed(3)}s）；` +
                `几何未动：startSec ${before.startSec}→${after.startSec}、lengthSec ${before.lengthSec}→${after.lengthSec}`,
        );
        check(
            '⑦a-提示 长按时出现「上=淡入淡出 / 下=变速」两个图标',
            seq.hintDuringHold !== null &&
                seq.hintDuringHold.pills.length === 2 &&
                seq.hintDuringHold.pills.some((p) => p.kind === 'fade') &&
                seq.hintDuringHold.pills.some((p) => p.kind === 'stretch'),
            `按住时浮层=${JSON.stringify(seq.hintDuringHold)}；定型后浮层=${seq.hintAfterLock ? '仍在' : '已收起'}`,
        );
    }

    // ── ⑦a2 尾控制点：上划 + 左横滑 = 淡出时长变长 ───────────────────────
    // （与 ⑦a 对称：规格的"上划"在头 = 淡入、在尾 = 淡出，两个入口都要成立。
    //   方向沿用电脑版：淡出包络是往**左**拉变长。）
    {
        await refit();
        const before = await readClip();
        const dx = -60;
        const seq = await twoStage(geo.hit.rightEdge, -34, dx);
        const after = await waitCommit(before);
        const expected = Math.abs(dx) / px();
        const delta = (after.fadeOutSec ?? 0) - (before.fadeOutSec ?? 0);
        check(
            '⑦a2 尾控制点·上划后左横滑 = 调淡出时长',
            delta > expected * 0.4 && delta > 0.01,
            `fadeOutSec ${before.fadeOutSec} → ${after.fadeOutSec}（期望 +≈${expected.toFixed(3)}s，实得 +${delta.toFixed(3)}s）；` +
                `淡入不受影响 ${before.fadeInSec} → ${after.fadeInSec}；` +
                `几何未动：lengthSec ${before.lengthSec}→${after.lengthSec}`,
        );
        check(
            '⑦a2-提示 尾控制点长按浮层写的是「↑淡出」',
            seq.hintDuringHold?.pills?.some((p) => p.kind === 'fade' && p.text.includes('淡出')) === true,
            `按住时浮层=${JSON.stringify(seq.hintDuringHold)}`,
        );
    }

    // ── ⑦b 控制点：下划 + 横滑 = 变速缩放（长度变、源区间不变）────────────
    //
    // 规格说的是「下划后再横滑调整变速缩放」，**没有限定头还是尾**：头尾两个控制点
    // 是同一个手势的两个入口（对应电脑版 Alt 拖左 / 右边缘）。所以优先用尾控制点
    // （更贴近直觉：往右拖 = 拉长放慢），尾控制点不在视口内时退回头控制点——
    // 两者都必须在真机上验到，不能因为"屏外按不到"就少验一半。
    {
        await refit();
        await fitTo(0.6);
        const useRight = geo.hit.inViewport;
        const anchor = useRight ? geo.hit.rightEdge : geo.hit.leftEdge;
        console.log(`▸ ⑦b 使用${useRight ? '尾' : '头'}控制点 ${JSON.stringify(anchor)}`);
        const before = await readClip();
        // 尾控制点往右拖 = 拉长；头控制点往右拖 = 缩短。两者都是"改长度 + 改速率"。
        // ⚠️ 位移方向**必须离开容器边缘**：内核在指针进入容器左右 32px
        // （`DRAG_EDGE_SCROLL_BAND_PX`）时启动**拖拽边缘自动滚屏**（最高
        // `720 × 1.5` px/s）。第一版从尾控制点往右拖，落点距容器右缘只剩 9px，
        // 于是"手指没动"的这段时间里视口一直在滚 ⇒ 位移被放大到 240px
        // （lengthSec 2 → 4.61，看着像公式错了，其实是**功能在正常工作**：
        // 自动滚屏的用途正是"拖出可视区"）。所以这里改为**往左缩短**：
        // 指针越拖越远离边缘，位移与读数一一对应。
        const DX = -40;
        const expectLength = before.lengthSec + DX / px();
        const seq = await twoStage(anchor, 34, DX, async () => {
            const mid = await cdp.call(inPageGeometry);
            return {
                lengthSec: mid.clip.lengthSec,
                clipPlaybackRate: mid.clip.clipPlaybackRate,
                startSec: mid.clip.startSec,
                playheadSec: mid.playheadSec,
                bpm: mid.bpm,
            };
        });
        const after = await waitCommit(before);
        console.log(`▸ ⑦b 按住时读数：${JSON.stringify(seq.midDrag)}`);
        const lengthChanged = Math.abs((after.lengthSec ?? 0) - (before.lengthSec ?? 0)) > 0.005;
        const rateChanged =
            Math.abs((after.clipPlaybackRate ?? 1) - (before.clipPlaybackRate ?? 1)) > 0.0005;
        const sourceSame =
            Math.abs((after.sourceStartSec ?? 0) - (before.sourceStartSec ?? 0)) < 0.005 &&
            Math.abs((after.sourceEndSec ?? 0) - (before.sourceEndSec ?? 0)) < 0.005;
        // 位移→长度是**一一对应**的（`computeClipStretch`：rate = baseRate×baseLen/期望长度，
        // 期望长度 = 指针处 − 固定边）。容差 0.3s 只为吸收网格吸附的量化
        // （120bpm ⇒ 0.5s 网格，最多偏 0.25s）；放大 5 倍那类错误会直接越界。
        const lengthExact = Math.abs((after.lengthSec ?? 0) - expectLength) < 0.3;
        check(
            `⑦b ${useRight ? '尾' : '头'}控制点·下划后横滑 = 变速缩放（内容不被裁掉）`,
            lengthChanged && rateChanged && sourceSame && lengthExact,
            `lengthSec ${before.lengthSec} → ${after.lengthSec}（期望 ${expectLength.toFixed(3)}，随手指位移 ${DX}px）；` +
                `clipPlaybackRate ${before.clipPlaybackRate} → ${after.clipPlaybackRate}；` +
                `源区间 ${before.sourceStartSec}~${before.sourceEndSec} → ${after.sourceStartSec}~${after.sourceEndSec}（应不变）`,
        );
        check(
            '⑦b-提示 长按时浮层出现（下划 = 变速）',
            seq.hintDuringHold !== null && seq.hintDuringHold.pills.some((p) => p.kind === 'stretch'),
            `按住时浮层=${JSON.stringify(seq.hintDuringHold)}`,
        );
    }

    // ── ⑦c 对照：**不满足长按**时横滑 = 普通裁切（不改淡变、不改速率）──────
    {
        await refit();
        const before = await readClip();
        await touch('touchStart', [{ id: 0, x: geo.hit.leftEdge.x, y: geo.hit.leftEdge.y }]);
        await sleep(120); // 远小于 500ms
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [
                { id: 0, x: geo.hit.leftEdge.x + (40 * i) / 4, y: geo.hit.leftEdge.y },
            ]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(500);
        const after = await waitCommit(before);
        const trimmed = Math.abs((after.startSec ?? 0) - (before.startSec ?? 0)) > 0.01;
        const fadeSame = Math.abs((after.fadeInSec ?? 0) - (before.fadeInSec ?? 0)) < 0.005;
        const rateSame = Math.abs((after.clipPlaybackRate ?? 1) - (before.clipPlaybackRate ?? 1)) < 0.001;
        check(
            '⑦c 未满长按 → 仍是普通裁切（不是淡变 / 变速）',
            trimmed && fadeSame && rateSame,
            `startSec ${before.startSec} → ${after.startSec}（应变）；fadeInSec ${before.fadeInSec} → ${after.fadeInSec}、` +
                `clipPlaybackRate ${before.clipPlaybackRate} → ${after.clipPlaybackRate}（应不变）`,
        );
    }

    // ── ⑦d 对照（尾控制点）：**不满足长按**时横滑 = 裁切（改源区间、不改速率）──
    // ⑦c 与 ⑦d 是 ⑦b 的反证：同一个"横滑"位移，长按成立与否必须走出**两条不同的
    // 分支**（变速 vs 裁切）。只验变速、不验裁切，就分不清"做对了"与"两条都走了变速"。
    {
        await refit();
        const before = await readClip();
        await touch('touchStart', [{ id: 0, x: geo.hit.rightEdge.x, y: geo.hit.rightEdge.y }]);
        await sleep(120);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [
                { id: 0, x: geo.hit.rightEdge.x - (40 * i) / 4, y: geo.hit.rightEdge.y },
            ]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(500);
        const after = await waitCommit(before);
        const sourceChanged = Math.abs((after.sourceEndSec ?? 0) - (before.sourceEndSec ?? 0)) > 0.005;
        const rateSame = Math.abs((after.clipPlaybackRate ?? 1) - (before.clipPlaybackRate ?? 1)) < 0.0005;
        check(
            '⑦d 尾控制点·未满长按 → 仍是普通裁切（改源区间，不改速率）',
            sourceChanged && rateSame,
            `sourceEndSec ${before.sourceEndSec} → ${after.sourceEndSec}（应变）；` +
                `clipPlaybackRate ${before.clipPlaybackRate} → ${after.clipPlaybackRate}（应不变）；` +
                `startSec ${before.startSec} → ${after.startSec}（应不变）`,
        );
    }

    // ── ⑦e 与电脑版等价性：同一位移下「下划 + 横滑」必须与「Alt + 拖边缘」一致 ──
    //
    // 规格原文把这条手势定义成"**相当于按 Alt 拖动块边缘**"⇒ 验收标准不是"看起来
    // 像变速"，而是**同一位移得到同一结果**。这也顺带守住"鼠标路径不许被改动"：
    // 内核新加的 `stretch` 标志是**可选字段**，触摸才会带上它；鼠标仍靠物理 Alt。
    {
        const DX = 40;
        const dragSteps = 4;
        const mouseDrag = async (from, dx, dy, alt) => {
            const mods = alt ? 1 : 0; /* CDP 位掩码：1 = Alt */
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: from.x,
                y: from.y,
                button: 'left',
                buttons: 1,
                clickCount: 1,
                modifiers: mods,
            });
            for (let i = 1; i <= dragSteps; i++) {
                await cdp.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: from.x + (dx * i) / dragSteps,
                    y: from.y + (dy * i) / dragSteps,
                    button: 'left',
                    buttons: 1,
                    modifiers: mods,
                });
                await sleep(45);
            }
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: from.x + dx,
                y: from.y + dy,
                button: 'left',
                buttons: 0,
                clickCount: 1,
                modifiers: mods,
            });
            await sleep(400);
        };

        // ① 触摸：下划定型 + 横滑（**先复位**，两条腿必须从同一基准出发）
        await resetAndImport(`hs-edge-eq-touch-${Date.now()}.wav`);
        await panToStart();
        await refit();
        await fitTo(0.6);
        const tail = { ...geo.hit.rightEdge };
        const base = await readClip();
        await twoStage(tail, 34, DX);
        const byTouch = await waitCommit(base);

        // ② 鼠标：Alt + 拖同一条边、同一位移（复位后 pxPerSec / 基准长度与①一致）
        await resetAndImport(`hs-edge-eq-mouse-${Date.now()}.wav`);
        await panToStart();
        await refit();
        await fitTo(0.6);
        const tail2 = { ...geo.hit.rightEdge };
        const base2 = await readClip();
        await mouseDrag(tail2, DX, 0, true);
        const byMouse = await waitCommit(base2);

        const sameGeometry =
            Math.abs(tail.x - tail2.x) <= 2 && Math.abs(base.lengthSec - base2.lengthSec) < 0.002;
        const dLen = Math.abs((byTouch.lengthSec ?? 0) - (byMouse.lengthSec ?? 0));
        const dRate = Math.abs((byTouch.clipPlaybackRate ?? 1) - (byMouse.clipPlaybackRate ?? 1));
        check(
            '⑦e 同位移下「下划+横滑」与「Alt+拖边缘」结果一致（规格的"相当于"）',
            sameGeometry && dLen < 0.02 && dRate < 0.002,
            `起点一致=${sameGeometry}（尾控制点 x ${tail.x} vs ${tail2.x}、基准长度 ${base.lengthSec} vs ${base2.lengthSec}）；` +
                `触摸 lengthSec=${byTouch.lengthSec}/rate=${byTouch.clipPlaybackRate} vs ` +
                `鼠标Alt lengthSec=${byMouse.lengthSec}/rate=${byMouse.clipPlaybackRate}`,
        );
    }

    // ── ③ 音频块-划动 = 未选中平移 / 已选中拖动块 / 淡入淡出区调时长 ────────
    // 前两条此前只在本轮会话中人工验过一次；这里连同"淡入淡出区"一起补成**可重跑**的
    // 断言。淡入淡出区的命中带：body 顶部 14px 横帽（`FADE_CORNER_CAP_HEIGHT_PX`）
    // 且距左/右缘 ≤ 22px（`FADE_CORNER_CAP_WIDTH_PX`）——注意**不是**边缘带，
    // 所以 y 要按"header + 7"取，而不是 ⑦ 用的边缘带中点。
    {
        await resetAndImport(`hs-edge-cell3-${Date.now()}.wav`);
        await panToStart();
        await refit();
        const g = geo;
        const bodyY = Math.round(g.hit.clipRect.top + 18 + 7);
        const clipTop = g.hit.clipRect.top;
        const bodyX = Math.round(Math.min(g.hit.clipRect.right - 20, g.hit.clipRect.left + 60));

        // ③-0 先点一下块体以外的地方取消选中（保证 ③a 的"未选中"前提成立）。
        await touch('touchStart', [{ id: 0, x: 132 + 200, y: g.hit.leftEdge.y + 120 }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(400);

        // ③a 未选中：块体上划动 = 平移视野
        const a0 = await cdp.call(inPageGeometry);
        await touch('touchStart', [{ id: 0, x: bodyX, y: clipTop + Math.round((g.hit.bands.localY + 0)) }]);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [{ id: 0, x: bodyX - (50 * i) / 4, y: clipTop + g.hit.bands.localY }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(500);
        const a1 = await cdp.call(inPageGeometry);
        check(
            '③a 音频块·未选中·划动 = 平移视野',
            Math.abs((a1.viewport.scrollLeft ?? 0) - (a0.viewport.scrollLeft ?? 0)) > 10 &&
                Math.abs((a1.clip.startSec ?? 0) - (a0.clip.startSec ?? 0)) < 0.005,
            `scrollLeft ${Math.round(a0.viewport.scrollLeft)} → ${Math.round(a1.viewport.scrollLeft)}；` +
                `块起点 ${a0.clip.startSec} → ${a1.clip.startSec}（应不动）`,
        );
        await panToStart();
        await refit();

        // ③b 已选中：点块体选中后横滑 = 拖动块
        await touch('touchStart', [{ id: 0, x: bodyX, y: clipTop + g.hit.bands.localY }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(500);
        const b0 = await readClip();
        await touch('touchStart', [{ id: 0, x: bodyX, y: clipTop + g.hit.bands.localY }]);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [
                { id: 0, x: bodyX + (30 * i) / 4, y: clipTop + g.hit.bands.localY },
            ]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        const b1 = await waitCommit(b0, 2500);
        check(
            '③b 音频块·已选中·划动 = 拖动块',
            Math.abs((b1.startSec ?? 0) - (b0.startSec ?? 0)) > 0.005 &&
                Math.abs((b1.lengthSec ?? 0) - (b0.lengthSec ?? 0)) < 0.01,
            `startSec ${b0.startSec} → ${b1.startSec}（期望 +≈${(30 / px()).toFixed(3)}s）；` +
                `lengthSec ${b0.lengthSec} → ${b1.lengthSec}（应不变）`,
        );
        await panToStart();
        await refit();

        // ③c 淡入淡出区：横滑 = 调整淡入淡出时长（**不需要长按**）
        //
        // ⚠️ 按点必须落在"淡变角**竖条**"的中段，而不是横帽的上沿：
        //   · 竖条：`x − 块左缘 ≤ 6`（`FADE_CORNER_EDGE_WIDTH_PX`），
        //     `y` 覆盖 body 顶部 `reserve`（= max(14, body/3) ≈ 45px）整段；
        //   · 第一版取 `y = 块顶 + 18 + 7`（横帽里非常靠上的一线），实测**按到了
        //     header 带**——`__hsViewport().containerRect` 与内核自己那个 container
        //     之间有几像素的竖直偏差，7px 的余量根本不够（触摸变成"平移视野"、
        //     鼠标变成"拖动块"，两条都不碰淡变，表现为淡入纹丝不动）。
        //   取 `块顶 + 40`（竖条中段）后，±20px 的偏差都还在淡变区里。
        const capX = geo.hit.clipRect.left + 3;
        const capY = geo.hit.clipRect.top + 40;
        console.log(`▸ ③c 按点 (${capX},${capY}) 块=${JSON.stringify(geo.hit.clipRect)} selected?=${await cdp.call(() => Boolean(document.querySelector('[data-hs-clip-actions]')))}`);
        const c0 = await readClip();
        await touch('touchStart', [{ id: 0, x: capX, y: capY }]);
        await sleep(80);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [{ id: 0, x: capX + (50 * i) / 4, y: capY }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        const c1 = await waitCommit(c0, 2500);
        const expectFade = 50 / px();
        const okTouch = (c1.fadeInSec ?? 0) - (c0.fadeInSec ?? 0) > expectFade * 0.5;
        if (!okTouch) {
            // 诊断①：同一按点**长按**应弹出淡变菜单（规格「长按」行：淡入淡出区打开菜单）
            // —— 菜单出现即证明该点确实是淡变区（而不是 body / header）。
            await touch('touchStart', [{ id: 0, x: capX, y: capY }]);
            await sleep(700);
            await touch('touchEnd', []);
            await sleep(400);
            const menu = await cdp.call(() => {
                const el = document.querySelector('[data-hs-context-menu="1"],[data-fade-ctx-menu]');
                return el ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 80) : null;
            });
            // 关掉菜单，免得污染后续断言
            await cdp.call(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
            await sleep(300);
            // 诊断②：同一位移改用**鼠标**（物理 Alt 不参与 ⇒ 走 fade 分支）
            const d0 = await readClip();
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: capX, y: capY, button: 'left', buttons: 1, clickCount: 1 });
            for (let i = 1; i <= 4; i++) {
                await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: capX + (50 * i) / 4, y: capY, button: 'left', buttons: 1 });
                await sleep(45);
            }
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: capX + 50, y: capY, button: 'left', buttons: 0, clickCount: 1 });
            const d1 = await waitCommit(d0, 2000);
            console.log(`▸ ③c 诊断：长按该点菜单=${JSON.stringify(menu)}；鼠标同点拖动 淡入 ${d0.fadeInSec} → ${d1.fadeInSec}`);
        }
        check(
            '③c 音频块·淡入淡出区·划动 = 调整淡入淡出时长',
            okTouch && Math.abs((c1.lengthSec ?? 0) - (c0.lengthSec ?? 0)) < 0.01,
            `淡入 ${c0.fadeInSec} → ${c1.fadeInSec}（期望 +≈${expectFade.toFixed(3)}s）；` +
                `lengthSec ${c0.lengthSec} → ${c1.lengthSec}（应不变，淡变不该改长度）`,
        );
    }

    // ── ② 音频块-单击 = 选中并显示常用操作与左右控制点 ────────────────────
    // 放在最后：清理与导入本来就走这条通道，顺带把它变成一条**显式断言**。
    // 控制点本身由上面 ⑦a（头）/⑦a2（尾）已经证明可按中，这里只验"单击出操作条"。
    {
        await resetAndImport(`hs-edge-actions-${Date.now()}.wav`);
        await panToStart();
        await refit();
        const before = await cdp.call(inPageGeometry);
        const tapX = Math.round(Math.min(before.hit.clipRect.right - 6, before.hit.clipRect.left + 60));
        await touch('touchStart', [{ id: 0, x: tapX, y: before.hit.leftEdge.y }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(600);
        const bar = await cdp.call(() => {
            const el = document.querySelector('[data-hs-clip-actions]');
            if (!el) return null;
            return {
                buttons: [...el.querySelectorAll('button')].map((b) => b.ariaLabel),
                top: Math.round(el.getBoundingClientRect().top),
            };
        });
        check(
            '② 音频块-单击 = 选中并显示常用操作条',
            bar !== null && bar.buttons.length >= 7 && bar.buttons.includes('删除'),
            `操作条=${JSON.stringify(bar)}`,
        );
        // 顺手用它清空工程（下一次运行从干净状态开始，探针因此可重复执行）。
        const cleared = await cdp.call(() => {
            const btn = [...document.querySelectorAll('[data-hs-clip-actions] button')].find(
                (b) => b.ariaLabel === '删除',
            );
            if (!btn) return false;
            btn.click();
            return true;
        });
        await sleep(900);
        const left = await cdp.call(inPageGeometry);
        check('②-收尾「删除」可用（工程清空）', cleared && left.clips === 0, `剩余块数=${left.clips}`);
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
}

await main();
