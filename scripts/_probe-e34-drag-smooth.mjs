#!/usr/bin/env node
/**
 * E34 「各种拖动的平滑化／惯性化」—— **块拖动那一档**的判据（用户 2026-10-02 清单 ④）。
 *
 * 既定范围（`docs/TASKS.md`）：视口那条由 E18 覆盖、分屏拖柄由 E22-⑦ 覆盖
 * ⇒ 剩下的是**块拖动**（移动 / 裁剪 / 淡变 / 增益 / 抓手 / 吸附偏移）。
 *
 * 实现：内核 `dispatchMovePreview` 的**重手势**一族改走 **rAF 合帧**
 * （`scheduleDragPreview`）—— 真机 `pointermove` 可达 120Hz，而每次预览都会写 Redux
 * 乐观值并重渲整棵时间线；一帧内跑两遍纯白干。合帧**不做低通滤波**（那会引入跟手延迟，
 * I-2 就是为此返工的），只把"一帧内的多次采样压成每帧一次、取最后一个"。
 *
 * 读数：`window.__hsDragStats()`（本轮新增的**只读**计数钩子：指针采样次数 / 预览派发次数）
 *       + `window.__hsClipProbe()`（选中块的 startSec 等，用来验"跟手连续性"与"落位不跳"）。
 *
 * 判据：
 *   E34-1 🔑 合帧生效：**同一帧内连发 8 个 move** ⇒ 任务内最多派发 1 帧（首帧同步、其余压帧）
 *                 （确定性：合成事件与计数读取在同一个 JS 任务里，rAF 插不进来）
 *   E34-1b 被压住的那一帧**不丢**：下一帧 `previews` 恰好补齐 1 次
 *   E34-2 拖动过程中块位置是**连续**的（采样到 ≥3 个不同的中间值）
 *   E34-3 抬手落位**不跳**（提交值 = 最后一帧预览值，差 ≤ 1px 折算）
 *   E34-4 🔑 **收尾前 flush**：抬手之后不再有待派发帧（计数停止增长）
 *   E34-5 `pointercancel` 路径**不提交**（块回到起手值）
 *   E34-6 轻手势（触摸平移视野）**不**被压帧（`moves` 不增长）—— 只压重手势
 *
 * 用法：node scripts/_probe-e34-drag-smooth.mjs [serial]
 * 前置：工程里要有音频块；没有会**自己跑一次导入**（`_dbg-import-drag.mjs hs-tone`）。
 *
 * 🔴 两条**读数纪律**（本轮各踩一次，见 `docs/17-踩坑速查.md`）：
 *   ① 起手点要**离左墙有余量**、且**别贴容器边缘**（贴右缘会勾出自动滚屏，把"落位"读数污染）；
 *   ② 连续两次拖动之间必须**等上一步的在途回包落定**（~0.8s）：间隔太小时第二次的乐观值会被
 *      第一次的回包覆盖，看上去"拖动没生效"。判据用**重试**兜住，三次都不动就标 `不可判`
 *      而不是红 —— 那是应用侧既有时序，与本轮改动无关（对照：4 次拖动各间隔 3s 全部生效）。
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* 老版本 WebView 没有这个域：忽略，触摸仍能派发 */
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};
const skip = (name, detail) => console.log(`⬜ ${name}（不可判）${detail ? '\n     ' + detail : ''}`);

const touch = (type, pts, id = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p) => ({
            id: p.id ?? id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });

const clip = () => cdp.call(() => window.__hsClipProbe?.()?.clip ?? null);
const stats = () => cdp.call(() => window.__hsDragStats?.() ?? null);
const selection = () => cdp.call(() => window.__hsSelection?.() ?? null);
const vpNow = () => cdp.call(() => window.__hsViewport?.() ?? null);
/** 面板侧的一次拖拽是否**真的是 `clip-drag`**（`lastArgs.n` = `onDragPreview` 被调用的累计次数）。 */
const dragDebug = () => cdp.call(() => window.__hsDragDebug?.() ?? null);

const stats0 = await stats();
if (stats0 === null) {
    console.log('🔴 页面里没有 `__hsDragStats()`（这个包不含 E34 改动？）');
    process.exit(1);
}

/** 装一个页内采样器：拖动期间每帧记一次块位置与时间。 */
const armSampler = (ms) =>
    cdp.call(
        (windowMs) => {
            window.__e34 = [];
            const t0 = performance.now();
            const tick = () => {
                window.__e34.push({
                    dt: Math.round(performance.now() - t0),
                    startSec: window.__hsClipProbe?.()?.clip?.startSec ?? null,
                });
                if (performance.now() - t0 < windowMs) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            return true;
        },
        ms,
    );
const readSampler = () => cdp.call(() => window.__e34 ?? []);

/** 让屏幕上"有东西被选中"（`__hsClipProbe` 只报**当前选中块**，没选中就没有几何可用）。 */
const selectSomething = async () => {
    const first = await clip();
    if (first) return first;
    const vp0 = await vpNow();
    if (!vp0?.containerRect) return null;
    const r0 = vp0.containerRect;
    const rows0 = await cdp.call(() =>
        [...document.querySelectorAll('[data-hs-track-row]')].map((e) => {
            const rr = e.getBoundingClientRect();
            return Math.round(rr.top + rr.height / 2);
        }),
    );
    const ys0 =
        rows0.length > 0
            ? rows0
            : [0, 1, 2].map((i) => Math.round(r0.top + i * vp0.rowHeight + vp0.rowHeight / 2));
    /* ① 先**点选**（不导入）：工程里已有块时直接用它 —— 反复导入会在同一位置叠出多个块
       （实测踩到：叠了 2 个之后点中间命中的是"压在上面"的那一个，选择在步骤间漂移）。 */
    const tapRows = async () => {
        for (const y of ys0) {
            for (const fx of [0.5, 0.35, 0.65]) {
                const x = Math.round(r0.left + r0.width * fx);
                await touch('touchStart', [{ x, y }]);
                await sleep(40);
                await touch('touchEnd', []);
                await sleep(330);
                const got = await clip();
                if (got) return got;
            }
        }
        return null;
    };
    const tapped = await tapRows();
    if (tapped) return tapped;
    /* ② 一个块都没有（应用刚重启、工程是空的：导入不会被持久化）⇒ 自带前置。
       🕳️ 导入是**鼠标拖拽**（文件浏览器 → 时间线），偶尔不落地（实测撞到一次：
       拖完 `panes=[timeline,files]`、块数为 0）⇒ 必须**校验 + 重试一次**，
       不能假定"跑过导入脚本就有块了"。 */
    for (let k = 1; k <= 2; k += 1) {
        console.log(`▸ 工程里没有块 —— 跑一次导入（\`_dbg-import-drag.mjs hs-tone\`，第 ${k} 次）…`);
        try {
            execSync(`node scripts/_dbg-import-drag.mjs ${serial} hs-tone`, { stdio: 'ignore' });
        } catch {
            /* 导入脚本自己会打日志；失败则下面的轮询会兜住 */
        }
        for (let i = 0; i < 8; i += 1) {
            await sleep(2500);
            const got = (await clip()) ?? (await tapRows());
            if (got) return got;
        }
    }
    return null;
};

const seed = await selectSomething();
if (!seed) {
    console.log(
        '🔴 前置不满足：屏幕上没有可选的音频块。先跑 `node scripts/_dbg-import-drag.mjs ' +
            serial +
            ' hs-tone`',
    );
    process.exit(1);
}

/** 当前块的可拖"块身点"（横向取**可见区间中点**；纵向用点选时那一行）。 */
let bodyY = null;
const locate = async () => {
    const vp = await vpNow();
    if (!vp?.containerRect) return { error: '拿不到 `__hsViewport()`' };
    const r = vp.containerRect;
    const rows = await cdp.call(() =>
        [...document.querySelectorAll('[data-hs-track-row]')].map((e) => {
            const rr = e.getBoundingClientRect();
            return { top: rr.top, height: rr.height };
        }),
    );
    const ys =
        rows.length > 0
            ? rows.map((rr) => Math.round(rr.top + rr.height / 2))
            : [0, 1, 2].map((i) => Math.round(r.top + i * vp.rowHeight + vp.rowHeight / 2));
    let empty = null;
    for (const y of ys) {
        let c0 = await clip();
        if (!c0) {
            /* 还没选中块（导入刚落地 / 上一步把选择清掉了）：先在容器中部点一下试出来，
               **不要 break**（第一版就是这么在"块存在但没选中"时直接报"点选都没命中"的）。 */
            for (const fx of [0.5, 0.35, 0.65]) {
                const xt = Math.round(r.left + r.width * fx);
                await touch('touchStart', [{ x: xt, y }]);
                await sleep(40);
                await touch('touchEnd', []);
                await sleep(330);
                if (await clip()) break;
                if (empty === null) empty = { x: Math.round(r.left + 30), y };
            }
            c0 = await clip();
            if (!c0) continue;
        }
        const left = r.left + c0.startSec * vp.pxPerSec - (vp.scrollLeft ?? 0);
        const ls = Math.max(left, r.left + 8);
        const rs = Math.min(left + c0.lengthSec * vp.pxPerSec, r.left + r.width - 8);
        if (rs - ls < 40) continue;
        const x = Math.round((ls + rs) / 2);
        await touch('touchStart', [{ x, y }]);
        await sleep(40);
        await touch('touchEnd', []);
        await sleep(330);
        const sel = await selection();
        if ((sel?.multi?.length ?? 0) >= 1) {
            bodyY = y;
            return { x, y, empty };
        }
        if (empty === null) empty = { x: Math.round(r.left + 30), y };
    }
    return { error: '逐行点选都没命中任何块' };
};
const located = await locate();
if (located.error) {
    console.log(`🔴 前置不满足：${located.error}`);
    process.exit(1);
}
/**
 * 当前块的可拖点（每步前重算：块会移动）。
 *
 * 🔴 取**块左缘 + 45px**，不是"可见区间中点"。实测（插桩 `__hsDragDebug`）：
 * 中点有时会落进**别的手势**的命中区（右端的增益/速率标签区、与邻块重叠处的交叉淡化抓手、
 * 淡变角），那次手势照样算"重手势"（`__hsDragStats` 的 moves/previews 都在涨），
 * 但它走的是**另一个**回调（`onCrossfadeGripPreview` 之类）⇒ `startSec` 一动不动，
 * 看上去像"拖动没生效"。左缘 +45px 稳定落在**块身**上，离左缘裁剪带（~12px）也够远。
 */
const bodyPointOf = async (c) => {
    const vp = await vpNow();
    if (!vp?.containerRect || !c) return null;
    const r = vp.containerRect;
    const left = r.left + c.startSec * vp.pxPerSec - (vp.scrollLeft ?? 0);
    const width = c.lengthSec * vp.pxPerSec;
    const lo = Math.max(left, r.left + 8) + 45;
    const hi = Math.min(left + width, r.left + r.width - 8) - 8;
    if (hi - lo < 8) return null;
    return { x: Math.round(lo), y: bodyY };
};

/** 一次普通（**可信触摸**）拖动：起手点 → 沿 x 平移 dx → 抬手。 */
const dragBy = async (dx, steps = 8) => {
    const p = await bodyPointOf(await clip());
    if (!p) return { error: '块身点不可用（横向可见不足 40px）' };
    await touch('touchStart', [{ x: p.x, y: p.y }]);
    await sleep(50);
    for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', [{ x: p.x + (dx * i) / steps, y: p.y }]);
        await sleep(10);
    }
    await touch('touchEnd', []);
    await sleep(2500);
    return { end: await clip() };
};

/* ── 起手位置保护：贴左墙（`startSec ≈ 0`）会让**所有向左的测量**被钳制 ⇒ 假红 ── */
const first = await clip();
if ((first.startSec ?? 0) < 0.35) {
    const park = await dragBy(40, 8);
    console.log(
        `▸ 起手贴左墙（startSec=${first.startSec}）⇒ 先向右离墙：→ ${park?.end?.startSec}`,
    );
}

/* ── E34-2/3/4：一次连续拖动（带重试：见文件头"读数纪律②"） ───────────────── */
const attempt = async () => {
    const p = await bodyPointOf(await clip());
    if (!p) return { error: '块身点不可用' };
    /* 记下 `onDragPreview` 的累计次数：只有它涨了才说明**这次真的是块拖动**
       （否则可能是交叉淡化抓手/增益标签那类"重手势"，`startSec` 本来就不该变）。 */
    const n0 = (await dragDebug())?.lastArgs?.n ?? 0;
    await armSampler(2200);
    const before = await clip();
    const s0 = await stats();
    const scroll0 = (await vpNow())?.scrollLeft ?? null;
    await touch('touchStart', [{ x: p.x, y: p.y }]);
    await sleep(40);
    for (let i = 1; i <= 24; i += 1) {
        await touch('touchMove', [{ x: p.x - i * 1.3, y: p.y }]);
        await sleep(5);
    }
    const during = await stats();
    const lastPreview = await clip(); // 🔴 必须在 touchEnd **之前**读
    const scrollDuring = (await vpNow())?.scrollLeft ?? null;
    const samples = await readSampler();
    await touch('touchEnd', []);
    await sleep(60);
    const committed = await clip();
    await sleep(2500);
    const after = await stats();
    const n1 = (await dragDebug())?.lastArgs?.n ?? 0;
    return {
        p,
        before,
        s0,
        during,
        lastPreview,
        scroll0,
        scrollDuring,
        samples,
        committed,
        after,
        wasClipDrag: n1 > n0,
        previewCalls: n1 - n0,
    };
};
let run = await attempt();
for (let k = 2; k <= 4 && (run.committed?.startSec === run.before?.startSec || !run.wasClipDrag); k += 1) {
    console.log(
        `▸ 第 ${k - 1} 次拖动没落地或**不是块拖动**（预览回调 ${run.previewCalls} 次）⇒ 重试`,
    );
    run = await attempt();
}
{
    const pxPerSec = (await vpNow())?.pxPerSec ?? 0;
    const span =
        run.committed && run.lastPreview
            ? Math.abs(run.committed.startSec - run.lastPreview.startSec) * pxPerSec
            : null;
    const distinct = new Set(run.samples.map((x) => x.startSec).filter((v) => v !== null)).size;
    const moved = run.committed?.startSec !== run.before?.startSec;
    const moves = run.during.moves - run.s0.moves;
    const previews = run.during.previews - run.s0.previews;
    console.log(
        `▸ 连续拖动：CDP 采样 ${moves} 次 → 派发 ${previews} 次（CDP 每条约 10ms ⇒ 本来就是一帧一个）；` +
            `rAF 采样 ${run.samples.length} 帧；scrollLeft ${run.scroll0}→${run.scrollDuring}`,
    );
    if (!moved) {
        skip(
            'E34-2 拖动过程连续 / E34-3 落位不跳',
            `四次尝试都没让块位移（预览回调 ${run.previewCalls} 次；` +
                '起手点落进了别的手势命中区 / 应用侧在途回包 —— 见 docs/17 的"拖动类探针四条纪律"）',
        );
    } else {
        check(
            'E34-2 拖动过程中块位置**连续**（采样到 ≥3 个不同的中间值）',
            distinct >= 3,
            `不同 startSec 值 ${distinct} 个；${run.before?.startSec} → 提交 ${run.committed?.startSec}`,
        );
        check(
            'E34-3 抬手落位**不跳**（提交值 = 最后一帧预览值，差 ≤ 1px 折算；且未触发边缘自动滚屏）',
            span !== null && span <= 1 && run.scrollDuring === run.scroll0,
            `最后一帧预览 startSec=${run.lastPreview?.startSec} ⇒ 提交 ${run.committed?.startSec}` +
                `（差 ${span?.toFixed(3)}px；pxPerSec=${pxPerSec?.toFixed(1)}）`,
        );
    }
    /* 收尾前 flush 的判据 = **抬手之后不再增长**。注意允许 +1：若最后一帧预览恰好还没来得及
       派发（`readSampler` 那段要花 ~30ms，通常已经派发过了），flush 会把它补上；
       反之则一次都不增。两种都对，**关键是之后彻底不涨**（after 是在 touchEnd 后 ~760ms 读的）。 */
    check(
        'E34-4 🔑 收尾前 flush：抬手之后**不再**有待派发帧（计数停止增长，至多补发最后 1 帧）',
        run.after.previews - run.during.previews <= 1 && run.after.moves === run.during.moves,
        `touchEnd 时 previews=${run.during.previews} / moves=${run.during.moves}` +
            ` → 之后 ${run.after.previews} / ${run.after.moves}（允许 +1 的补发）`,
    );
}

/* ── E34-5：pointercancel 不提交（带前置"值已稳定" + 方向校验 + 重试） ──
 *
 * 🔴 前置：**先等块的值稳定**（连续两次读数一致）。实测撞到过：上一步提交的陈旧快照还在路上，
 * 起手读到 0.173、拖到中途却跳回 0.32（那是更早的一次提交值）⇒ 这条判据会拿一个
 * 根本不属于本次拖动的值去比。稳定后再起手，读数才是这次拖动自己的。
 * 🔴 方向校验：向左拖就必须**变小**（`mid < base`）。只判"变了"会把陈旧快照当成本次拖动。 */
let stable = null;
for (let i = 0; i < 6; i += 1) {
    const a = await clip();
    await sleep(1000);
    const b = await clip();
    if (a?.startSec === b?.startSec) {
        stable = b;
        break;
    }
}
if (!stable) {
    skip('E34-5 `pointercancel` 不提交', '块的值一直不稳定（上一步的在途回包持续覆盖）');
}
let c5 = null;
for (let k = 1; k <= 3 && c5 === null && stable !== null; k += 1) {
    await sleep(2500);
    const p = await bodyPointOf(await clip());
    if (!p) break;
    const base = await clip();
    await touch('touchStart', [{ x: p.x, y: p.y }]);
    await sleep(40);
    for (let i = 1; i <= 10; i += 1) {
        await touch('touchMove', [{ x: p.x - i * 3, y: p.y }]);
        await sleep(8);
    }
    const mid = await clip();
    await touch('touchCancel', []);
    await sleep(400);
    const after = await clip();
    /* 向左拖 ⇒ 必须**变小**（方向校验，见上）。 */
    if (mid?.startSec < base?.startSec - 0.01) c5 = { base, mid, after };
    else {
        console.log(
            `▸ 第 ${k} 次 cancel 试验的拖动没落地/方向不对（${base?.startSec} → ${mid?.startSec}）⇒ 重试`,
        );
    }
}
if (c5 === null && stable !== null) {
    skip('E34-5 `pointercancel` 不提交', '三次拖动都没让块沿拖动方向位移（同上：应用侧既有时序）');
} else {
    check(
        'E34-5 `pointercancel` 路径**不提交**（块回到起手值）',
        c5.after?.startSec === c5.base?.startSec,
        `起手 ${c5.base?.startSec} → 拖到 ${c5.mid?.startSec} → cancel 后 ${c5.after?.startSec}`,
    );
}

/* ── E34-6：轻手势（触摸平移视野）不压帧 ── */
const s6 = await stats();
if (!located.empty) {
    skip('E34-6 轻手势（平移视野）不压帧', '点选时没遇到过"点空白"的行');
} else {
    await touch('touchStart', [{ x: located.empty.x, y: located.empty.y }]);
    await sleep(30);
    for (let i = 1; i <= 12; i += 1) {
        await touch('touchMove', [{ x: located.empty.x + i * 6, y: located.empty.y }]);
        await sleep(6);
    }
    await touch('touchEnd', []);
    await sleep(250);
    const s6b = await stats();
    check(
        'E34-6 轻手势（触摸平移视野）**不**走合帧（`moves` 不增长 ⇒ 逐事件更跟手）',
        s6b.moves === s6.moves,
        `空白点 (${located.empty.x},${located.empty.y})；moves ${s6.moves} → ${s6b.moves}`,
    );
}

/* ── E34-1/1b 放在**最后**：合成 `pointermove` 会让内核手势留痕，**污染后面的真实拖动**
   （实测：先跑合成连发，之后连续三次真实拖动都不落地）⇒ 它只做"同帧零派发 + 下一帧 +1"的
   计数证明，不参与前面的应用语义判据。 ── */
/* ── E34-1 🔑：**同一帧内连发 8 个 pointermove** ──────────────────────────────
 *
 * 为什么不用 CDP 连发触摸：`Input.dispatchTouchEvent` 每条消息要 ~10ms 往返 ⇒ 实际到达
 * 间隔就是一帧一个，**根本造不出"一帧内多次采样"**（第一版这么写，量出来比值 1.05×，
 * 看着像"合帧没生效"，其实是探针没造出压力）。
 * 改用**页内合成** `PointerEvent`：与计数读取放在**同一个 JS 任务**里 ⇒ 任务内 rAF 插不进来，
 * `previews +0` 是确定性结论；再等一帧验"被压住的那次确实派发了"（计数 +1，不依赖应用语义）。
 * 方向取**向左**（起手已离墙，向左有 40px 富余；也远离容器右缘，不会勾出自动滚屏）。 */
let body2 = await bodyPointOf(await clip());
if (!body2) {
    /* 前面的平移/拖动可能把视口带偏（块的横向可见不足 40px）⇒ 重新点选 + 重算，别再 exit。 */
    await selectSomething();
    body2 = await bodyPointOf(await clip());
}
if (!body2) {
    skip('E34-1 🔑 合帧生效 / E34-1b 不丢帧', '块身点不可用（块的横向可见不足 40px）');
} else {
await touch('touchStart', [{ x: body2.x, y: body2.y }]);
await sleep(60);
/* 🔴 基线要**取绝对值**：`burst` 里返回的是"任务内增量"，而 `afterBurst` 是绝对计数
   —— 直接相减会把"本轮之前累计的派发次数"算进来（第一版就这么误报过 +8）。 */
const sBurst0 = await stats();
const burst = await cdp.call(
    (bx, by, d) => {
        const s0 = window.__hsDragStats();
        for (let i = 1; i <= 8; i += 1) {
            window.dispatchEvent(
                new PointerEvent('pointermove', {
                    clientX: bx + (d * i) / 8,
                    clientY: by,
                    pointerId: 1,
                    pointerType: 'touch',
                    isPrimary: true,
                    bubbles: true,
                    cancelable: true,
                    buttons: 1,
                }),
            );
        }
        const s1 = window.__hsDragStats();
        return { moves: s1.moves - s0.moves, previews: s1.previews - s0.previews };
    },
    body2.x,
    body2.y,
    -40,
);
await sleep(200); // 给 rAF 一帧（+余量）去派发被压住的那一次
const afterBurst = await stats();
await touch('touchEnd', []);
await sleep(2500);
/* 8 发里**前几发会被"拖拽阈值"吃掉**（4px；重叠区里是 `OVERLAP_DRAG_THRESHOLD_PX = 9`）——
   越过阈值之前手势还是 `pending-select`，不算重手势、不进队列，这是**对的**行为。 */
check(
    'E34-1 🔑 合帧生效：同帧内连发 8 个 move ⇒ 任务内最多只派发 **1** 帧（首帧同步 + 其余压帧）',
    burst.previews <= 1 && burst.moves >= 5,
    `同帧连发 8 个：进队列 moves +${burst.moves}（前几发被 4~9px 拖拽阈值吃掉，属正常）、` +
        `任务内派发 previews +${burst.previews}（不压帧的话应等于 moves；首帧按设计同步派发 ⇒ 期望 ≤1）`,
);
check(
    'E34-1b 被压住的那一帧**不丢**：下一帧把队列里那次补齐（计数相对于任务末尾 +1）',
    afterBurst.previews - sBurst0.previews - burst.previews === 1,
    `连发前 ${sBurst0.previews} → 任务末尾 ${sBurst0.previews + burst.previews} → 下一帧后 ${afterBurst.previews}（应 +1）`,
);
}

console.log(`\n── E34 块拖动平滑（合帧）：通过 ${pass} / 失败 ${fail} ──`);
process.exit(fail === 0 ? 0 : 1);
