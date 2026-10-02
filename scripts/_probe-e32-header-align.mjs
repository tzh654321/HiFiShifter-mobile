/**
 * E32 判据 —— 「轨道头缩回后，轨道头与轨道区（时间线）**高度不对齐**」
 *
 * 用户口径（2026-10-02）：「轨道头缩回且**分屏位置较高**时轨道与轨道头没对齐高度」。
 *
 * 复现到的真因（`index.css` 收起态那条规则）：
 *   `[data-track-list-panel]` 的父是 **column** 弹性盒，`flex-basis`/`flex-grow` 管的是**高度**，
 *   而规则里写的 `flex: 0 0 auto !important` 把 `flex-1`（`1 1 0%`）的「撑满剩余」也抹掉了
 *   ⇒ 列表高度塌成**内容高**（实测真机 284 → 112px，下方空出 172px）
 *   ⇒ 左侧轨道头只显示半行多一点，右侧轨道区仍是全高 ⇒ 用户看到的「高度不对齐」。
 *
 * 判据设计要点：
 *   ① **一定要用真实触摸手势**触发左划收起（`TimelinePanel` 的原生 touch 监听挂在列表容器上，
 *      `document.body.setAttribute(...)` 只能验 CSS，验不了"手势还能不能触发"）；
 *   ② 收起后**列表高度必须与展开态一致**（这是修复的核心，也是回归护栏）；
 *   ③ 行与头的**接缝**（`row0.top − bar.bottom`）必须恒为 0；
 *   ④ 覆盖用户说的「分屏位置较高」那个态：把分界线**上拖**（轨道块变矮）再测一次；
 *   ⑤ 窄条里**右划展开**必须还能用（修 `flex` 时最容易把它弄坏）。
 *
 * 用法：node scripts/_probe-e32-header-align.mjs <serial>
 */
import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";

const serial = process.argv[2] || "221deeb";
const PKG = "com.arounder.hifishifter";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adb = (cmd) => execSync(`adb -s ${serial} ${cmd}`, { encoding: "utf8" }).replace(/\r/g, "");

const pid = adb(`shell pidof ${PKG}`).trim();
if (!pid) {
    console.error(`🔴 ${PKG} 未运行`);
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");

const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
            type === "touchEnd"
                ? []
                : [{ id: 0, x: Math.round(x), y: Math.round(y), radiusX: 6, radiusY: 6, force: 1 }],
    });

/* ── 读数 ─────────────────────────────────────────────────────────── */

const readGeom = () =>
    cdp.call(() => {
        const panel = document.querySelector("[data-track-list-panel]");
        const bar = document.querySelector("[data-hs-tracklist-head-bar]");
        if (!panel || !bar) return null;
        const rows = [...panel.querySelectorAll("[data-hs-track-row]")];
        const R = (e) => {
            const r = e.getBoundingClientRect();
            return {
                t: +r.top.toFixed(1),
                h: +r.height.toFixed(1),
                l: +r.left.toFixed(1),
                w: +r.width.toFixed(1),
            };
        };
        const shell = panel.parentElement;
        return {
            collapsed: document.body.hasAttribute("data-hs-header-collapsed"),
            bar: R(bar),
            shell: shell ? R(shell) : null,
            panel: {
                ...R(panel),
                scrollTop: panel.scrollTop,
                clientH: panel.clientHeight,
                scrollH: panel.scrollHeight,
            },
            rowCount: rows.length,
            row0: rows[0] ? R(rows[0]) : null,
            rowH: rows[0] ? +rows[0].getBoundingClientRect().height.toFixed(1) : null,
        };
    });

/** 左划收起（真实触摸；`dx` 需 < −48 且 `dy` ≤ 24）。 */
const swipeCollapse = async () => {
    const g = await readGeom();
    const cx = Math.min(g.panel.l + g.panel.w - 12, g.panel.l + g.panel.w / 2 + 30);
    const cy = g.panel.t + Math.min(60, g.panel.h / 2);
    await touch("touchStart", cx, cy);
    await sleep(50);
    for (let i = 1; i <= 4; i += 1) {
        await touch("touchMove", cx - (70 * i) / 4, cy);
        await sleep(50);
    }
    await touch("touchEnd", 0, 0);
    await sleep(700);
};

/** 在 26px 窄条上**右划展开**。 */
const swipeExpand = async () => {
    const g = await readGeom();
    const cx = g.panel.l + Math.max(8, g.panel.w / 2);
    const cy = g.panel.t + Math.min(60, g.panel.h / 2);
    await touch("touchStart", cx, cy);
    await sleep(50);
    for (let i = 1; i <= 4; i += 1) {
        await touch("touchMove", cx + (70 * i) / 4, cy);
        await sleep(50);
    }
    await touch("touchEnd", 0, 0);
    await sleep(700);
};

/** 把分屏分界线拖到指定"轨道块高度占比"（用户口径的「分屏位置较高/较低」）。 */
const dragSplitTo = async (factorOfCurrent) => {
    const h = await cdp.call(() => {
        const pane = document.querySelector('[data-hs-pane="timeline"]');
        const handle = document.querySelector('[data-hs-split-handle="param-toolbar"]');
        if (!pane || !handle) return null;
        const rp = pane.getBoundingClientRect();
        const rh = handle.getBoundingClientRect();
        return {
            x: Math.round(rh.left + rh.width / 2),
            y: Math.round(rh.top + rh.height / 2),
            span: Math.round(rp.height),
        };
    });
    if (!h) return null;
    const dy = Math.round(h.span * factorOfCurrent);
    await touch("touchStart", h.x, h.y);
    await sleep(60);
    for (let i = 1; i <= 6; i += 1) {
        await touch("touchMove", h.x, h.y + (dy * i) / 6);
        await sleep(45);
    }
    await touch("touchEnd", 0, 0);
    await sleep(800);
    return dy;
};

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✅" : "🔴"} ${name}`);
    console.log(`      ${detail}`);
};

/* ── 0. 准备：收敛到「timeline + params」两块（`param-toolbar` 手柄只在这块上有），
       并确保轨道头是展开态。

   ⚠️ `hs-mobile-switch-tab`（`{tab}`）是**累加开**（幂等）；`hs-mobile-close-panel`
      （`{key}`）是 **toggle**（不是幂等关闭）—— 拿它当"关"用，面板本来是关的就会被打开
      （本轮踩过：想关 files/notes，结果把 params 挤掉了，`param-toolbar` 手柄随之消失，
      判据整条不可判）。所以这里先读现状，**只对真在场的面板** toggle。 */
const panesNow = () =>
    cdp.call(() => [...document.querySelectorAll("[data-hs-pane]")].map((e) => e.getAttribute("data-hs-pane")));

for (let round = 0; round < 3; round += 1) {
    const cur = await panesNow();
    const extra = cur.filter((k) => k !== "timeline" && k !== "params");
    if (extra.length > 0) {
        await cdp.call((keys) => {
            for (const key of keys) {
                window.dispatchEvent(new CustomEvent("hs-mobile-close-panel", { detail: { key } }));
            }
            return true;
        }, extra);
        await sleep(1500);
    }
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
        window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "params" } }));
        document.body.removeAttribute("data-hs-header-collapsed");
        return true;
    });
    await sleep(1800);
    const after = await panesNow();
    if (after.includes("timeline") && after.includes("params") && after.length === 2) break;
}
console.log("▸ 面板：", JSON.stringify(await panesNow()));

let g0 = await readGeom();
if (!g0) {
    console.error("🔴 找不到轨道列表（面板没挂上）");
    cdp.close();
    process.exit(1);
}
console.log(
    `▸ 展开态：bar=${JSON.stringify(g0.bar)} panel=h${g0.panel.h} scrollTop=${g0.panel.scrollTop}` +
        ` row0.t=${g0.row0?.t} rowH=${g0.rowH} 行数=${g0.rowCount}`,
);

/* ── 1. 左划收起 ──────────────────────────────────────────────────── */

await swipeCollapse();
const g1 = await readGeom();
console.log(
    `▸ 收起态：collapsed=${g1.collapsed} panel=w${g1.panel.w}×h${g1.panel.h}` +
        ` shell=w${g1.shell?.w} row0.t=${g1.row0?.t} bar.h=${g1.bar.h}`,
);

check(
    "E32-1 左划真的收起了（`data-hs-header-collapsed` 置位 + 面板收窄到 ~26px）",
    g1.collapsed === true && g1.panel.w <= 30,
    `collapsed=${g1.collapsed} panel.w=${g1.panel.w} shell.w=${g1.shell?.w}`,
);

check(
    "E32-2 🔑 **收起后列表高度与展开态一致**（修前塌成内容高）",
    Math.abs(g1.panel.h - g0.panel.h) <= 2,
    `展开 ${g0.panel.h}px → 收起 ${g1.panel.h}px（Δ${+(g1.panel.h - g0.panel.h).toFixed(1)}）` +
        `；内容高 scrollH=${g1.panel.scrollH}`,
);

check(
    "E32-3 收起后「头行底 = 第 0 行顶」的接缝仍为 0",
    Math.abs(g1.row0.t - (g1.bar.t + g1.bar.h)) <= 1,
    `bar 底 ${+(g1.bar.t + g1.bar.h).toFixed(1)} vs row0 顶 ${g1.row0.t}`,
);

/* ── 2. 窄条里右划展开（修 flex 时最容易弄坏的一条） ───────────────── */

await swipeExpand();
const g2 = await readGeom();
check(
    "E32-4 窄条里**右划能展开**回来（宽度恢复、高度仍一致）",
    g2.collapsed === false && g2.panel.w > 60 && Math.abs(g2.panel.h - g0.panel.h) <= 2,
    `collapsed=${g2.collapsed} w=${g2.panel.w} h=${g2.panel.h}（展开基准 ${g0.panel.h}）`,
);

/* ── 3. 用户口径的「分屏位置较高」：把分界线往上拖（轨道块变矮）再测 ── */

const moved = await dragSplitTo(-0.25);
let gHigh = null;
if (moved !== null) {
    gHigh = await readGeom();
    console.log(`▸ 分界线上拖 ${moved}px 后：轨道块 h=${gHigh?.shell?.h} 行高=${gHigh?.rowH}`);
    await swipeCollapse();
    const gHighC = await readGeom();
    console.log(`▸ （分界线较高）收起态：panel=h${gHighC.panel.h} row0.t=${gHighC.row0?.t}`);

    check(
        "E32-5 「**分屏位置较高**」时收起 ⇒ 列表高度仍与同态展开时一致（用户点的场景）",
        Math.abs(gHighC.panel.h - (gHigh.panel.h ?? 0)) <= 2,
        `同态展开 ${gHigh.panel.h}px → 收起 ${gHighC.panel.h}px` +
            `（Δ${+((gHighC.panel.h ?? 0) - (gHigh.panel.h ?? 0)).toFixed(1)}）`,
    );

    await swipeExpand();
    /* 把分界线拖回原处（上拖改变了 `mobileSplitRatio` 并**持久化**，
       不复位会让下一次运行的起点是脏状态）。 */
    await dragSplitTo(0.25);
    await sleep(400);
} else {
    check(
        "E32-5 「分屏位置较高」时收起 ⇒ 列表高度一致",
        false,
        "找不到分屏手柄 `[data-hs-split-handle=\"param-toolbar\"]`（该态不可判）",
    );
}

/* ── 4. 滚动位置同步：收起后滚到底，再展开 ⇒ 左右（头/轨道区）同源 ── */

await cdp.call(() => {
    const panel = document.querySelector("[data-track-list-panel]");
    if (panel) panel.scrollTop = panel.scrollHeight;
    return true;
});
await sleep(400);
const gScrolled = await readGeom();
await swipeCollapse();
const gScrolledC = await readGeom();
check(
    "E32-6 收起态**不把滚动位置钳掉**（列表高度够，scrollTop 不会被 clamp 回 0）",
    gScrolled.panel.scrollTop === 0 || gScrolledC.panel.scrollTop >= gScrolled.panel.scrollTop - 2,
    `收起前 scrollTop=${gScrolled.panel.scrollTop} → 收起后 ${gScrolledC.panel.scrollTop}` +
        `（scrollH=${gScrolledC.panel.scrollH} clientH=${gScrolledC.panel.clientH}）`,
);
await swipeExpand();

/* ── 收尾：复位到展开态 ───────────────────────────────────────────── */

await cdp.call(() => {
    document.body.removeAttribute("data-hs-header-collapsed");
    return true;
});

const pass = results.filter((r) => r.ok).length;
console.log(`\n通过 ${pass} / ${results.length}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
