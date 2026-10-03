#!/usr/bin/env node
/**
 * E38 判据（#1 的**决定性**版本）—— 下方面板权重之和 < 1 时也必须**铺满**。
 *
 * 为什么不能只用现成的 `_probe-e37-closepane-fill.mjs`：
 *   它量的是"当前 localStorage 里的权重"下的行为。而**各设备的权重是持久化的、值各不相同**：
 *   真机上 `params = 0.700051`（Σ<1 ⇒ flexbox 只填 70% ⇒ 留白 99px，用户报的那个）；
 *   模拟器上早先的 E25 探针留下的是 `params ≈ 1.55`（Σ≥1 ⇒ **修不修都铺满** ⇒ 判据假过）。
 *   ⇒ 要真正验这条修复，必须**人为把可见集合的权重压到 < 1** 再量。
 *
 * 做法（会**重置一次 app 进程**，并临时改写 localStorage）：
 *   1. 记下用户/探针原来的权重，**收尾时还原**；
 *   2. 写 `{params: 0.700051, files: 0.3, notes: 0.3}`（= 真机那份触发值）+ 重启 app
 *      （权重只在挂载时读 ⇒ 必须重启；这里用 `am force-stop` + `am start`，
 *       比 `Page.reload` 干净 —— 后者会让 CDP 的 execution context 失效）；
 *   3. 打开「轨道 + 参数」，**关掉文件**，量参数面板是否铺满下方可用区；
 *   4. 还原 localStorage + 重启。
 *
 * 判据：
 *   E38-F5 权重和 < 1（单块可见 0.700051）时，参数面板**仍然铺满**（留白 ≤ 2px）
 *   E38-F6 此时下发给 `flex-grow` 的是**归一化后**的值（≈1，而不是 0.700051）
 *
 * 用法：node scripts/_probe-e38-lower-fill.mjs [serial]
 */
import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";

const serial = process.argv[2] ?? "emulator-5554";
const PKG = "com.arounder.hifishifter";
const KEY = "hifishifter.mobileLowerWeights";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { encoding: "utf8" }).replace(/\r/g, "");

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? "✅" : "🔴"} ${name}${detail ? "\n     " + detail : ""}`);
    if (ok) pass += 1;
    else fail += 1;
};

/** 连一次 CDP（每次重启后 pid 会变 ⇒ 转发与 attach 都要重来）。 */
const attach = async () => {
    const pid = adb(`shell pidof ${PKG}`).trim();
    if (!pid) throw new Error("app 未运行");
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
    await cdp.send("Runtime.enable");
    return cdp;
};

const restartApp = async () => {
    adb(`shell am force-stop ${PKG}`);
    await sleep(1200);
    adb(`shell am start -n ${PKG}/.MainActivity`);
    await sleep(22000);
};

/* ── 1. 先连上，读原来的权重（稍后还原） ───────────────────────────── */
let cdp = await attach();
const originalWeights = await cdp.call((k) => localStorage.getItem(k), KEY);
console.log("▸ 原权重：" + originalWeights);
const originalRatio = await cdp.call(() => localStorage.getItem("hifishifter.mobileSplitRatio"));

/* ── 2. 写入"真机那份触发值"并重启 ─────────────────────────────────── */
await cdp.call(
    (k, v) => {
        localStorage.setItem(k, v);
        return true;
    },
    KEY,
    JSON.stringify({ params: 0.700051, files: 0.3, notes: 0.3 }),
);
/* ⚠️ **必须等它落盘再重启**：Chromium 的 localStorage 是**异步提交**的，写完 1s 就
   `force-stop` 会丢掉这次写入 —— 重启后读到的是默认权重 `{1,1,1}`（Σ=1 ⇒ **修不修都铺满**），
   判据会**假过**。第一版就是这样：`stored` 读回 `null` 却"通过"了 ⇒ 现在加前置断言。 */
await sleep(4000);
cdp.close();
await restartApp();
cdp = await attach();

/* ── 3. 打开「轨道 + 参数」，关掉文件 ─────────────────────────────── */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
    window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "params" } }));
    await new Promise((r) => setTimeout(r, 2600));
});
// 把可能残留的 files/notes 关掉（`close-panel` 是 **toggle** ⇒ 只对真在场的发）
for (let i = 0; i < 4; i += 1) {
    const cur = await cdp.call(() =>
        [...document.querySelectorAll("[data-hs-pane]")].map((e) => e.getAttribute("data-hs-pane")),
    );
    const extra = cur.filter((k) => k !== "timeline" && k !== "params");
    if (extra.length === 0) break;
    await cdp.call((keys) => {
        for (const k of keys) {
            window.dispatchEvent(new CustomEvent("hs-mobile-close-panel", { detail: { key: k } }));
        }
        return true;
    }, extra);
    await sleep(2000);
}
const panes = await cdp.call(() =>
    [...document.querySelectorAll("[data-hs-pane]")].map((e) => e.getAttribute("data-hs-pane")),
);
console.log("▸ 当前面板：" + JSON.stringify(panes));

const geo = await cdp.call(() => {
    const pane = document.querySelector('[data-hs-pane="params"]');
    if (!pane) return null;
    const wrap = pane.parentElement;
    const tool = wrap.querySelector(".hs-param-toolrow");
    const pb = pane.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const tb = tool ? tool.getBoundingClientRect() : null;
    return {
        wrapBottom: Math.round(wb.bottom),
        toolBottom: tb ? Math.round(tb.bottom) : null,
        paneH: Math.round(pb.height),
        paneBottom: Math.round(pb.bottom),
        inlineGrow: pane.style.flexGrow,
        stored: localStorage.getItem("hifishifter.mobileLowerWeights"),
    };
});
console.log("▸ 几何：" + JSON.stringify(geo));

/* 🔴 前置断言：**先证明"触发条件真的成立"**，再谈结论。
   否则（写入没落盘 / 被打回默认值）会得到一个"Σ=1 ⇒ 修不修都铺满"的**假通过**。 */
const storedApplied = typeof geo.stored === "string" && geo.stored.includes("0.700051");
check(
    "E38-P 前置：`params=0.700051`（Σ<1）**真的被重启后的进程读到**（否则判据会假过）",
    storedApplied,
    `localStorage = ${geo.stored}`,
);
if (!storedApplied) {
    console.log("🔴 前置不成立 ⇒ 该态**不可判**（探针没把权重写进去，不是产品问题）");
    cdp.close();
    process.exit(1);
}

const expected = geo.toolBottom !== null ? geo.wrapBottom - geo.toolBottom : null;
check(
    "E38-F5 权重和 < 1（单块可见 = 0.700051）时**仍然铺满**下方可用区（留白 ≤ 2px）",
    expected !== null && Math.abs(geo.paneBottom - geo.wrapBottom) <= 2,
    `可用 ${expected}px，实测面板高 ${geo.paneH}px（面板底 ${geo.paneBottom} vs 外壳底 ${geo.wrapBottom}）` +
        `　修前这里是 230 / 329 ⇒ 差 99px`,
);

check(
    "E38-F6 下发给 `flex-grow` 的是**归一化后**的值（≈1，而不是 0.700051）",
    Number(geo.inlineGrow) >= 0.999 && Number(geo.inlineGrow) <= 1.001,
    `inline flex-grow = ${geo.inlineGrow}（存储值仍是 0.700051，归一化只发生在下发时）`,
);

/* ── 3.5 对照组：把 inline 值**改回未归一化的 0.700051** ⇒ 必须立刻出现留白 ──
   （证明"这条判据测得到这个 bug"，而不是碰巧恒真。） */
const control = await cdp.call(() => {
    const pane = document.querySelector('[data-hs-pane="params"]');
    const wrap = pane.parentElement;
    pane.style.flexGrow = "0.700051";
    const pb = pane.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const blank = Math.round(wb.bottom - pb.bottom);
    // 复原（交回 React 的下一次渲染/本次结论）
    pane.style.flexGrow = "1";
    return { paneH: Math.round(pb.height), wrapH: Math.round(wb.height), blank };
});
check(
    "E38-F7 对照：把 inline 改回 `0.700051`（未归一化）⇒ **立刻留白**（判据有灵敏度）",
    control.blank > 20,
    `对照组：面板高 ${control.paneH}px / 外壳 ${control.wrapH}px ⇒ 留白 ${control.blank}px（>20 才算测得到）`,
);

/* ── 4. 还原 ─────────────────────────────────────────────────────── */
cdp.close();
const restore = await attach();
await restore.call(
    (k, w, r) => {
        if (w === null) localStorage.removeItem(k);
        else localStorage.setItem(k, w);
        if (r !== null) localStorage.setItem("hifishifter.mobileSplitRatio", r);
        return true;
    },
    KEY,
    originalWeights,
    originalRatio,
);
restore.close();
console.log("▸ 已还原原权重");

console.log(`\n── E38 权重和 < 1 时铺满：通过 ${pass} / 失败 ${fail} ──`);
process.exit(fail === 0 ? 0 : 1);
