#!/usr/bin/env node
/**
 * E38 判据 —— 拖动轨道**松手落位**不许"从原位置/来回弹"（用户 2026-10-03 #10）：
 * 「拖轨道到特殊位置**下方轨道来回弹**；松手归位**从原位置**开始弹」。
 *
 * 根因（代码级）：松手那一帧 `dragUi` 变 null、内联 `translateY` 被移除 —— 若同时把行的
 * `transition: transform …180ms` 也恢复，CSS 过渡会与 FLIP 的 WAAPI 动画**同时**作用于
 * `transform`（一个从旧槽滑回、一个从视觉位置吸附）⇒ 看到的就是来回弹。
 * 修法：过渡**只在拖动进行中**给（`dragUi !== null && !dragging`），松手帧不带过渡，
 * 落位完全交给 FLIP（它已按"拖动中的视觉位置"起算）。
 *
 * 判据：
 *   E38-S1 松手后的沉降窗口内，轨道行上**没有 `CSSTransition`**（只允许 FLIP 的 WAAPI 动画）
 *   E38-S2 被拖行的 `translateY` 序列**单调趋向落位**（不得出现方向反转 = 回弹）
 *   E38-S3 沉降结束后 transform 归零（不留常驻 transform）
 *   E38-S4 顺序真的变了（证明这轮拖拽本身生效，判据不是空转）
 *
 * 用法：node scripts/_probe-e38-release-settle.mjs [serial]
 */
import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";

const serial = process.argv[2] ?? "221deeb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, "");
if (!pid) {
    console.error("🔴 app 未运行");
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

const touch = (type, pts) =>
    cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 6,
            radiusY: 6,
            force: 1,
        })),
    });

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? "✅" : "🔴"} ${name}${detail ? "\n     " + detail : ""}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* ── 0. 面板 + ≥2 行 ─────────────────────────────────────────────── */

await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
    document.body.removeAttribute("data-hs-header-collapsed");
    await new Promise((r) => setTimeout(r, 2600));
});
for (let i = 0; i < 6; i += 1) {
    const n = await cdp.call(() => document.querySelectorAll("[data-hs-track-row]").length);
    if (n >= 2) break;
    await cdp.call(() => {
        const add = [...document.querySelectorAll("div")].find(
            (d) => (d.textContent || "").trim() === "添加轨道",
        );
        add?.click();
    });
    await sleep(1400);
}

const geometry = () =>
    cdp.call(() => {
        const host = document.querySelector("[data-track-list-panel]");
        if (!host) return null;
        const ty = (el) => {
            const t = getComputedStyle(el).transform;
            if (!t || t === "none") return 0;
            try {
                return new DOMMatrixReadOnly(t).m42;
            } catch {
                return NaN;
            }
        };
        const rows = [...host.querySelectorAll("[data-hs-track-row]")];
        return {
            ids: rows.map((r) => r.getAttribute("data-hs-track-row")),
            rows: rows.map((r) => {
                const b = r.getBoundingClientRect();
                return {
                    id: r.getAttribute("data-hs-track-row"),
                    cx: Math.round(b.left + 62),
                    cy: Math.round(b.top - ty(r) + b.height / 2),
                    h: Math.round(b.height),
                    ty: ty(r),
                };
            }),
        };
    });

const g0 = await geometry();
if (!g0 || g0.rows.length < 2) {
    console.log("🔴 轨道不足 2 行 ⇒ 不可判");
    cdp.close();
    process.exit(1);
}
console.log("▸ 初始行：" + JSON.stringify(g0.ids));

/* ── 1. 采样子：松手**之后**的沉降窗口（含每行的动画类型） ─────────── */

const armSampler = (draggingId) =>
    cdp.call((id) => {
        const host = document.querySelector("[data-track-list-panel]");
        window.__e38 = { log: [], stop: false };
        const ty = (el) => {
            const t = getComputedStyle(el).transform;
            if (!t || t === "none") return 0;
            try {
                return Math.round(new DOMMatrixReadOnly(t).m42);
            } catch {
                return NaN;
            }
        };
        const t0 = performance.now();
        const tick = () => {
            if (window.__e38.stop) return;
            const rows = [...host.querySelectorAll("[data-hs-track-row]")];
            window.__e38.log.push({
                dt: Math.round(performance.now() - t0),
                dragged: (() => {
                    const el = rows.find((r) => r.getAttribute("data-hs-track-row") === id);
                    return el ? ty(el) : null;
                })(),
                /**
                 * E38-S2 的判据数据用**绝对屏幕位置**，**不能**只用 `translateY`：
                 * 重排一旦提交，该行的**基准布局位置也跟着变**（比如从第 1 槽换到第 2 槽）
                 * ⇒ 同一段"连续向上"的视觉运动，在**行内局部坐标**里会从 −66 跳到 +14
                 * ——那是基准变了，不是方向反转。
                 * 实测：拖 66px、槽间距 80px ⇒ `round()` 判成换 1 格 ⇒ 松手后局部
                 * translateY 由 −66 → +14，而视觉上其实**继续向上** 14px 落到槽位。
                 */
                draggedTop: (() => {
                    const el = rows.find((r) => r.getAttribute("data-hs-track-row") === id);
                    return el ? Math.round(el.getBoundingClientRect().top) : null;
                })(),
                /* 每行身上的动画：`Animation` = WAAPI（FLIP）；`CSSTransition` = CSS 过渡。
                   修前松手帧会把过渡恢复 ⇒ 这里能看到 `CSSTransition` 且 `transform`。 */
                anims: rows.flatMap((r) =>
                    r
                        .getAnimations()
                        .map(
                            (a) =>
                                `${a.constructor.name}:${
                                    a.transitionProperty ?? a.animationName ?? ""
                                }`,
                        ),
                ),
                left: rows.map((r) => ty(r)),
            });
            /* 🔴 采样窗必须**覆盖到松手之后**：手势开始前还有 560ms 等待 + 4×70ms 移动
               + 140ms ≈ 980ms ⇒ 窗口若 < 1000ms，采样器会在 `touchEnd` **之前**就停，
               S6 量到的是**拖动段**的位移、而非"滑回原位"的中间值 = **空转式通过**。
               取 2200ms 覆盖「拖动 → 松手 → 180ms 沉降 + 余量」。 */
            if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    }, draggingId);

/* ── 2. 真实手势 A：短按选中 ⇒ 长按 560ms ⇒ **上拖 0.8 格**后松手 ────
   为什么不是正好一整格：正好一格时"视觉位置 == 目标槽位"⇒ FLIP 无事可做、零动画，
   判据 E38-S1（不得有 CSS 过渡）就成了**空转**。拖 0.8 格 ⇒ 目标槽位差 0.2 格
   ⇒ FLIP 必须补这一段 ⇒ 窗口里**必定**有 WAAPI 动画 ⇒ S1 才是有效对照。 */

const rowIdx = 1;
const r0 = g0.rows[rowIdx];
await touch("touchStart", [{ x: r0.cx, y: r0.cy }]);
await sleep(60);
await touch("touchEnd", []);
await sleep(950);

let gMid = await geometry();
let r = gMid.rows.find((x) => x.id === g0.ids[rowIdx]);
await touch("touchStart", [{ x: r.cx, y: r.cy }]);
await sleep(560);
const dragStep = Math.round((r.h * 0.8) / 6);
for (let i = 1; i <= 6; i += 1) {
    await touch("touchMove", [{ x: r.cx, y: r.cy - dragStep * i }]);
    await sleep(70);
}
await sleep(140);

/* 采样器要在**松手之前**装好（沉降窗口只有 180ms，晚了就采不到） */
await armSampler(g0.ids[rowIdx]);
await touch("touchEnd", []);
await sleep(1200);

const log = await cdp.call(() => {
    window.__e38.stop = true;
    return window.__e38.log || [];
});
const g1 = await geometry();

/* ── 3. 判据 ─────────────────────────────────────────────────────── */

const transitions = [...new Set(log.flatMap((s) => s.anims).filter((a) => a.startsWith("CSSTransition")))];
check(
    "E38-S1 松手后的沉降窗口里**没有 CSS 过渡**参与（`transform` 只由 FLIP 的 WAAPI 驱动）",
    transitions.length === 0,
    transitions.length
        ? `发现 ${JSON.stringify(transitions.slice(0, 4))}（修前会有 CSSTransition:transform ⇒ 与 FLIP 抢 = 回弹）`
        : `动画样本：${JSON.stringify([...new Set(log.flatMap((s) => s.anims))].slice(0, 4))}`,
);

/* S2 的度量：**到"最终落位"的距离不得回涨**（>1px 就算一次回弹）。
   用绝对屏幕位置（`draggedTop`）而不是局部 `translateY` —— 重排会换基准，
   局部坐标的符号翻转是基准位移、不是回弹（见采样器里 `draggedTop` 的注释）。 */
const seq = log
    .map((s) => s.draggedTop)
    .filter((v) => typeof v === "number" && !Number.isNaN(v));
const finalTop = seq.length > 0 ? seq[seq.length - 1] : null;
let bounces = 0;
let minDist = Infinity;
if (finalTop !== null) {
    for (const v of seq) {
        const dist = Math.abs(v - finalTop);
        if (dist > minDist + 1) bounces += 1;
        if (dist < minDist) minDist = dist;
    }
}
check(
    "E38-S2 被拖行**单调趋向落位**（到落点的距离不回涨 = 不回弹）",
    finalTop !== null && bounces === 0,
    `回涨 ${bounces} 次；绝对位置序列前 12 个：${JSON.stringify(seq.slice(0, 12))}；落点=${finalTop}`,
);

check(
    "E38-S3 沉降结束后不留常驻 transform",
    g1.rows.every((x) => x.ty === 0),
    JSON.stringify(g1.rows.map((x) => x.ty)),
);

check(
    "E38-S4 顺序真的变了（这轮拖拽本身生效，判据不是空转）",
    JSON.stringify(g1.ids) !== JSON.stringify(g0.ids),
    `${JSON.stringify(g0.ids)} → ${JSON.stringify(g1.ids)}`,
);

/* S5：窗口里必须**真的**有 FLIP 的 WAAPI 动画 —— 否则 S1（不得有 CSS 过渡）是**空转**
   （一个动画都没有，当然没有 CSS 过渡）。 */
const waapi = [...new Set(log.flatMap((s) => s.anims).filter((a) => a.startsWith("Animation")))];
check(
    "E38-S5 沉降窗口里确实有 FLIP 的 WAAPI 动画在工作（S1 才不是空转）",
    waapi.length > 0,
    waapi.length ? `动画样本：${JSON.stringify(waapi.slice(0, 3))}` : "窗口里一个动画都没有 ⇒ S1 无意义",
);

/* ── 4. 手势 B：**没跨过槽位**就松手 ⇒ 必须"滑回原位"而不是瞬跳（E38-S6/S7） ──
   没跨过槽位 ⇒ 没有重排 ⇒ FLIP 不跑（它只在 `[tracks]` 更新时跑）⇒ 若不额外给一段过渡，
   清掉内联 `translateY` 就是**瞬跳**。修法是收尾时先下发"位移归零"的状态（过渡开着）、
   滑完再清 —— 于是采样里能看到**中间值**。 */

const gB0 = await geometry();
const bIdx = gB0.rows.length > 1 ? 1 : 0;
const bRow = gB0.rows[bIdx];
await touch("touchStart", [{ x: bRow.cx, y: bRow.cy }]);
await sleep(60);
await touch("touchEnd", []);
await sleep(950);
const gB1 = await geometry();
const bRow2 = gB1.rows.find((x) => x.id === gB0.ids[bIdx]);
const bStep = Math.max(1, Math.round(bRow2.h * 0.3));
await armSampler(gB0.ids[bIdx]);
await touch("touchStart", [{ x: bRow2.cx, y: bRow2.cy }]);
await sleep(560);
for (let i = 1; i <= 4; i += 1) {
    await touch("touchMove", [{ x: bRow2.cx, y: bRow2.cy + (bStep * i) / 4 }]);
    await sleep(70);
}
await sleep(140);
const duringB = await cdp.call(() => {
    const el = [...document.querySelectorAll("[data-hs-track-row]")][1];
    const t = getComputedStyle(el).transform;
    return t === "none" ? 0 : Math.round(new DOMMatrixReadOnly(t).m42);
});
await touch("touchEnd", []);
await sleep(1100);
const logB = await cdp.call(() => {
    window.__e38.stop = true;
    return window.__e38.log || [];
});
const gB2 = await geometry();

const seqB = logB.map((s) => s.dragged).filter((v) => typeof v === "number" && !Number.isNaN(v));
const mid = seqB.filter((v) => Math.abs(v) > 0.5 && Math.abs(v) < Math.abs(duringB) - 0.5);
check(
    "E38-S6 没跨过槽位就松手 ⇒ 被拖行**滑回原位**（采样到中间位移，不是瞬跳）",
    seqB.length > 0 && mid.length >= 2,
    `拖动中 ty=${duringB}；松手后序列前 14 个：${JSON.stringify(seqB.slice(0, 14))}`,
);
check(
    "E38-S7 该手势**没有**改变顺序（证明它确实走的是「未提交」那条收尾路径）",
    JSON.stringify(gB2.ids) === JSON.stringify(gB1.ids),
    `${JSON.stringify(gB1.ids)} → ${JSON.stringify(gB2.ids)}`,
);

console.log(`\n── E38 松手落位（不回弹）：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
process.exit(fail === 0 ? 0 : 1);
