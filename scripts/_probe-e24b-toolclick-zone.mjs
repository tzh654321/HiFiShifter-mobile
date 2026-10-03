#!/usr/bin/env node
/**
 * 判据：参数工具行两个按钮的「**切换 vs 开菜单**」落点分区（#7 / `docs/prompt.md:113`）。
 *
 * 为什么需要它：`_probe-e24-toolmenu.mjs` 的点击助手明写「**左上内缩 8px，避开右下角标命中区**」
 * —— 它**故意绕开**角标，所以「落在角标/右下 18×18 上 ⇒ 弹菜单而不是切换」这条路**从来没被测过**，
 * 那条探针 7/7 全绿证明不了用户的问题。
 *
 * 用户口径（`docs/prompt.md:113` 亲笔）：
 *   「点击**未选择**的工具后**直接切换**，点击**选择中**的工具**展开工具菜单**，展开菜单后点击别处可以收起」
 *
 * ⚠️ 纪律：**只有被测量的落点用真实触摸**（`Input.dispatchTouchEvent`）；开菜单/选条目/收起
 * 一律走**页内 `.click()`** —— 否则"点别处收起"若点到系统状态栏，会把通知栏拉下来、卡死 WebView
 * （第一版就是这么超时 30s 的）。
 *
 * 判据：
 *   Z1 按钮本体**中心** + 目标是**未选中**工具 ⇒ **切换**、不得开菜单
 *   Z2 **组内**：「拖动」选中时点「选择」中心 ⇒ 按 L113 仍是"未选择" ⇒ **必须切换**（现实现因同组判成已选中而开菜单）
 *   Z3 点**右下角标** ⇒ 按设计**开菜单**（"正常点击容易误触"的那个落点）
 *   Z4 **长按 600ms**（> 400ms 门槛）⇒ 按设计**开菜单**
 *   Z5 几何：量化"会开菜单的落点"占按钮面积的**比例**
 *
 * 用法：node scripts/_probe-e24b-toolclick-zone.mjs [serial]
 */
import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";

const serial = process.argv[2] ?? "221deeb";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { encoding: "utf8" }).replace(/\r/g, "");

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? "✅" : "🔴"} ${name}${detail ? "\n     " + detail : ""}`);
    if (ok) pass += 1;
    else fail += 1;
};

const pid = adb("shell pidof com.arounder.hifishifter").trim();
if (!pid) {
    console.error("🔴 app 未运行（先 adb shell am start -n com.arounder.hifishifter/.MainActivity）");
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

/** 真触摸一下（默认 60ms = 正常"点"）。**只在被测量的落点上用**。 */
const tap = async (x, y, holdMs = 60) => {
    await touch("touchStart", [{ x, y }]);
    await sleep(holdMs);
    await touch("touchEnd", []);
    await sleep(520);
};

/* ── 0. 打开参数面板（工具行在参数面板块里） ─────────────────────────── */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
    window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "params" } }));
    await new Promise((r) => setTimeout(r, 2600));
});

const readState = () =>
    cdp.call(() => {
        const box = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return {
                left: Math.round(b.left),
                top: Math.round(b.top),
                right: Math.round(b.right),
                bottom: Math.round(b.bottom),
                w: Math.round(b.width),
                h: Math.round(b.height),
                cx: Math.round(b.left + b.width / 2),
                cy: Math.round(b.top + b.height / 2),
            };
        };
        const selAnchor = document.querySelector("[data-hs-select-anchor]");
        const drwAnchor = document.querySelector("[data-hs-draw-anchor]");
        const selBtn = selAnchor ? selAnchor.closest("button") : null;
        const drwBtn = drwAnchor ? drwAnchor.closest("button") : null;
        return {
            selBtn: box(selBtn),
            drwBtn: box(drwBtn),
            selCorner: box(document.querySelector("[data-hs-select-corner]")),
            drwCorner: box(document.querySelector("[data-hs-draw-corner]")),
            selActive: selBtn ? selBtn.getAttribute("aria-pressed") === "true" : null,
            drwActive: drwBtn ? drwBtn.getAttribute("aria-pressed") === "true" : null,
            drawTool: drwAnchor ? drwAnchor.getAttribute("data-hs-draw-tool") : null,
            selMenu: !!document.querySelector("[data-hs-select-tool-menu]"),
            drwMenu: !!document.querySelector("[data-hs-draw-tool-menu]"),
        };
    });

/** 页内收起菜单（点透明 backdrop ⇒ onClose）。不产生真实触摸。 */
const closeMenus = async () => {
    await cdp.call(() => {
        const bd = document.querySelector(".hs-tool-menu__backdrop");
        if (bd) bd.click();
        return true;
    });
    await sleep(320);
};

/** 页内开某个工具菜单（点它的角标元素 ⇒ onCornerClick）。 */
const openMenu = async (which) => {
    await cdp.call((w) => {
        const el = document.querySelector(w === "select" ? "[data-hs-select-corner]" : "[data-hs-draw-corner]");
        if (el) el.click();
        return true;
    }, which);
    await sleep(420);
};

/** 页内选菜单条目（按 label 文本）并读回状态。 */
const pickRow = async (which, label) => {
    const ok = await cdp.call(
        (w, lab) => {
            const menu = document.querySelector(w === "select" ? "[data-hs-select-tool-menu]" : "[data-hs-draw-tool-menu]");
            if (!menu) return false;
            const rows = [...menu.querySelectorAll("button[role='menuitemradio']")];
            const hit = rows.find((r) => (r.textContent || "").trim() === lab);
            if (!hit) return false;
            hit.click();
            return true;
        },
        which,
        label,
    );
    await sleep(700);
    return ok;
};

/** 通过菜单把工具设成 `label`。 */
const setTool = async (which, label) => {
    await closeMenus();
    await openMenu(which);
    const ok = await pickRow(which, label);
    await closeMenus();
    return ok;
};

/* ── 1. 前置：工具行必须在场 ─────────────────────────────────────────── */
const s0 = await readState();
if (!s0.selBtn || !s0.drwBtn) {
    console.log("🔴 找不到参数工具行的工具按钮 ⇒ 不可判（参数面板没开？）");
    console.log("   " + JSON.stringify(s0));
    cdp.close();
    process.exit(1);
}
console.log("▸ 选择按钮 " + JSON.stringify(s0.selBtn));
console.log("▸ 绘制按钮 " + JSON.stringify(s0.drwBtn));
console.log(
    "▸ 选择角标 " + JSON.stringify(s0.selCorner) + "　绘制角标 " + JSON.stringify(s0.drwCorner),
);
console.log("▸ 初始：selActive=" + s0.selActive + " drwActive=" + s0.drwActive + " drawTool=" + s0.drawTool);

/* ── Z1 本体中心点「未选中」工具 ⇒ 应切换、不开菜单 ──────────────────── */
{
    const set = await setTool("draw", "绘制");
    const st = await readState();
    console.log("▸ [Z1 前置] 设为「绘制」：drawTool=" + st.drawTool + "（设置" + (set ? "成功" : "失败") + "）");
    const b = st.selBtn;
    await tap(b.cx, b.cy);
    const s1 = await readState();
    check(
        "Z1 点**本体中心**、目标工具未选中 ⇒ **切换**、不开菜单",
        s1.selActive === true && s1.selMenu === false,
        `落点=(${b.cx},${b.cy})；结果 selActive=${s1.selActive} selMenu=${s1.selMenu}`,
    );
    await closeMenus();
}

/* ── Z1b 对照组：点**角标区之外**（按钮左上内缩 8px）⇒ 必须切换 ──────────
   这条是**因果对照**：若 Z1 红而 Z1b 绿 ⇒ 说明"开菜单"确实是**角标命中区**造成的，
   而不是 `onSelectClick` 的判定逻辑整体坏了。（E24 探针点的就是这个点 ⇒ 所以它一直绿。） */
{
    const st = await readState();
    const b = st.selBtn;
    const x = b.left + 8;
    const y = b.top + 8;
    await tap(x, y);
    const s1 = await readState();
    check(
        "Z1b 对照：点按钮**左上内缩 8px**（角标区之外）⇒ **切换**、不开菜单（证明 Z1 的红是角标吃掉的）",
        s1.selActive === true && s1.selMenu === false,
        `落点=(${x},${y})；结果 selActive=${s1.selActive} selMenu=${s1.selMenu}`,
    );
    await closeMenus();
}

/* ── Z2b 「拖动」选中时点**角标区之外** ⇒ 隔离"同组判成已选中"这条 ────── */
{
    const set = await setTool("select", "拖动");
    const st = await readState();
    const b = st.selBtn;
    const x = b.left + 8;
    const y = b.top + 8;
    await tap(x, y);
    const s1 = await readState();
    check(
        "Z2b 「拖动」选中时点**角标区之外** ⇒ 隔离验证 L113 的「未选择的工具 ⇒ 直接切换」",
        s1.selMenu === false,
        `落点=(${x},${y})；结果 selMenu=${s1.selMenu}（true ⇒ "同组即已选中"这条判定本身也不符 L113）${set ? "" : "（前置设置失败）"}`,
    );
    await closeMenus();
}
/* ── Z2 组内切换：「拖动」选中时点「选择」**中心** ⇒ 按 L113 应切换 ───── */
{
    const set = await setTool("select", "拖动");
    const st = await readState();
    console.log(
        "▸ [Z2 前置] 设为「拖动」：selActive=" +
            st.selActive +
            "（设置" +
            (set ? "成功" : "失败") +
            "；拖动与选择同组 ⇒ 都显示激活）",
    );
    const b = st.selBtn;
    await tap(b.cx, b.cy);
    const s1 = await readState();
    check(
        "Z2 「拖动」选中时点「选择」中心 ⇒ 按 L113 是**未选择**工具 ⇒ **必须切换**（不得开菜单）",
        s1.selMenu === false,
        `落点=(${b.cx},${b.cy})；结果 selMenu=${s1.selMenu}（true ⇒ 就是这条老问题）`,
    );
    await closeMenus();
}

/* ── Z3 点在**右下角标**上 ⇒ 按设计开菜单（误触面对照） ──────────────── */
{
    await setTool("draw", "绘制");
    const st = await readState();
    const c = st.selCorner;
    const x = c.cx;
    const y = c.cy;
    await tap(x, y);
    const s1 = await readState();
    check(
        "Z3 点按钮**右下角标**中心 ⇒ 按设计**开菜单**（这是「正常点击容易误触」的落点）",
        s1.selMenu === true,
        `落点=(${x},${y}) = 角标 ${c.w}×${c.h} 的中心；按钮 ${st.selBtn.w}×${st.selBtn.h}；结果 selMenu=${s1.selMenu}`,
    );
    await closeMenus();
}

/* ── Z3b 点在按钮**右下内缩 8px**（用户自认还是"本体"）⇒ ？ ─────────── */
{
    await setTool("draw", "绘制");
    const st = await readState();
    const b = st.selBtn;
    const x = b.right - 8;
    const y = b.bottom - 8;
    await tap(x, y);
    const s1 = await readState();
    check(
        "Z3b 点按钮**右下内缩 8px** ⇒ 记录是「切换」还是「开菜单」（用户说的「点本体却弹窗」多半落在这里）",
        s1.selMenu === false,
        `落点=(${x},${y})，按钮 ${b.w}×${b.h}；结果 selMenu=${s1.selMenu} selActive=${s1.selActive}`,
    );
    await closeMenus();
}

/* ── Z4 长按 600ms（> 400ms 门槛）⇒ 按设计开菜单 ─────────────────────── */
{
    await setTool("draw", "绘制");
    const st = await readState();
    const b = st.selBtn;
    await tap(b.cx, b.cy, 600);
    const s1 = await readState();
    check(
        "Z4 **长按 600ms** 按钮本体 ⇒ 按设计**开菜单**（>400ms 门槛，误触的另一条路）",
        s1.selMenu === true,
        `落点=(${b.cx},${b.cy}) 按住 600ms；结果 selMenu=${s1.selMenu}`,
    );
    await closeMenus();
}

/* ── Z6 对称检查：**绘制按钮中心**是否也被它自己的角标吃掉 ──────────────
   选择角标已证（Z1/Z1b）。绘制侧有两套判据：按钮本体的"右下 18×18"几何判定
   （`onPencilClick` 的 `inCorner`）+ `[data-hs-draw-corner]` 元素自身的 onClick。
   按钮中心 (58,293) 不满足 `clientX >= right-18(=60)` ⇒ 几何判定放行；
   但它**落在** `[data-hs-draw-corner]` 的矩形 (56..70, 291..305) 里 ⇒ 取决于那个元素是否 stopPropagation。 */
{
    const set = await setTool("select", "选择");
    const st = await readState();
    const b = st.drwBtn;
    console.log("▸ [Z6 前置] 设为「选择」：selActive=" + st.selActive + "（设置" + (set ? "成功" : "失败") + "）");
    await tap(b.cx, b.cy);
    const s1 = await readState();
    check(
        "Z6 对称：**绘制按钮中心**（从「选择」切回绘制）⇒ 应**直接切换**、不开菜单",
        s1.drwMenu === false,
        `落点=(${b.cx},${b.cy})；结果 drwMenu=${s1.drwMenu} drwActive=${s1.drwActive} drawTool=${s1.drawTool}`,
    );
    await closeMenus();
}

/* ── Z5 几何：量化"会开菜单的落点"占按钮面积的比例 ───────────────────── */
{
    const st = await readState();
    const b = st.drwBtn;
    const zone = Math.max(0, Math.min(18, b.w)) * Math.max(0, Math.min(18, b.h));
    const ratio = zone / (b.w * b.h);
    const sc = st.selCorner;
    const sb = st.selBtn;
    const ovW = sc ? Math.max(0, Math.min(sc.right, sb.right) - Math.max(sc.left, sb.left)) : 0;
    const ovH = sc ? Math.max(0, Math.min(sc.bottom, sb.bottom) - Math.max(sc.top, sb.top)) : 0;
    console.log(
        `▸ 几何：绘制按钮 ${b.w}×${b.h}，其"右下 18×18 即开菜单"判据 ⇒ 占按钮面积 **${(ratio * 100).toFixed(0)}%**`,
    );
    console.log(
        `▸ 几何：选择角标 ${sc ? `${sc.w}×${sc.h}` : "?"} 与按钮的重叠 ${ovW}×${ovH} ⇒ 占按钮面积 **${(((ovW * ovH) / (sb.w * sb.h)) * 100).toFixed(0)}%**` +
            `（角标还会**外扩**出按钮：右 ${sc && sb ? sc.right - sb.right : "?"}px、下 ${sc && sb ? sc.bottom - sb.bottom : "?"}px）`,
    );
    console.log(
        `▸ 结论口径：用户"点工具本体"时，落在上表这些区域就会**弹菜单而不是切换**；` +
            `另有 400ms 长按那条路。`,
    );
}

console.log(`\n── 工具按钮落点分区：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
process.exit(fail === 0 ? 0 : 1);
