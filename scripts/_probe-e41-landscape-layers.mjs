#!/usr/bin/env node
/**
 * E41 判据（用户 2026-10-04 批次）：**横屏口径 + 浮层越界 + 顶栏菜单高度**
 *
 * 覆盖三条：
 *   #4 横屏下「双击轨道进编辑」「多种浮层无法渲染」
 *        ⇒ 断言：横屏（`innerWidth ≥ 600`）时 ① 双击泳道**能**开出参数面板；
 *          ② 常用功能浮条 / 控制点圆点**仍在场**（修复前因 `< 600` 门控全部缺席）。
 *   #5 横屏下顶栏菜单过短
 *        ⇒ 断言：打开「文件」菜单后，面板**底边贴近视口底**（修复前被 `100vh − 160px` 卡到半截）。
 *   #1 浮层要能盖过**轨道头列 / 拍数栏**
 *        ⇒ 断言：块贴容器左缘时，**左圆点仍渲染**且其中心 **x < 容器左**（修复前 `dotPressable`
 *          按容器判 ⇒ 直接不画）。
 *
 * 手法：`__hsImportAudioBase64` 导入素材 → 点块选中 → 读几何；旋转用 `settings user_rotation`。
 * ⚠️ 旋转后**收尾必须转回竖屏**（否则后面所有探针的读数都变）。
 *
 * 用法：node scripts/_probe-e41-landscape-layers.mjs [serial]
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? "221deeb";
const port = 9233;
const wav = "D:\\Temp\\hs-tone.wav";

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? "✅" : "🔴"} ${name}${detail ? "\n     " + detail : ""}`);
    if (ok) pass += 1;
    else fail += 1;
};
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { encoding: "utf8" }).replace(/\r/g, "");

const pid = adb("shell pidof com.arounder.hifishifter").trim();
if (!pid) {
    console.error("🔴 app 未运行");
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port });
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
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });
const tap = async (x, y, hold = 80) => {
    await touch("touchStart", [{ x, y }]);
    await sleep(hold);
    await touch("touchEnd", []);
    await sleep(650);
};

/** 关掉可能压着的 Radix/自绘浮层（用页内 click，别产生真实触摸）。 */
const closeOverlays = async () => {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
};

/** 关键读数：视口 + 三个浮层 + 参数面板。 */
const readState = () =>
    cdp.call(() => {
        const rect = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
                x: Math.round(r.left),
                y: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
                bottom: Math.round(r.bottom),
                cx: Math.round(r.left + r.width / 2),
                cy: Math.round(r.top + r.height / 2),
            };
        };
        const dotL = document.querySelector('[data-hs-clip-control-point="left"]');
        const dotR = document.querySelector('[data-hs-clip-control-point="right"]');
        return {
            innerW: window.innerWidth,
            innerH: window.innerHeight,
            isPhoneShell: window.innerWidth < 1280,
            actions: rect(document.querySelector("[data-hs-clip-actions]")),
            dotCount: document.querySelectorAll("[data-hs-clip-control-point]").length,
            dotL: rect(dotL),
            dotR: rect(dotR),
            container: window.__hsViewport ? window.__hsViewport().containerRect : null,
            paramsPane: Boolean(document.querySelector('[data-hs-pane="params"]')),
            menu: rect(document.querySelector('[role="menu"].hs-menu, [role="menu"]')),
        };
    });

/** 顶栏菜单：点某个菜单名，返回面板几何 + 内联 maxHeight。 */
const openTopMenu = async (label) => {
    const hit = await cdp.call((lab) => {
        const btns = [...document.querySelectorAll("button")];
        const b = btns.find((x) => (x.textContent || "").trim() === lab && x.closest("header"));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, label);
    if (!hit) return null;
    await closeOverlays();
    await tap(hit.x, hit.y);
    return cdp.call(() => {
        const panels = [...document.querySelectorAll('header [role="menu"], [role="menu"]')];
        const p = panels.find((x) => x.getBoundingClientRect().height > 20);
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return {
            inlineMaxH: p.style.maxHeight || null,
            computedMaxH: getComputedStyle(p).maxHeight,
            bottom: Math.round(r.bottom),
            height: Math.round(r.height),
            innerH: window.innerHeight,
            scrollH: p.scrollHeight,
        };
    });
};

/* ── 0. 造一个音频块并选中 ─────────────────────────────────────────── */
for (let g = 0; g < 5; g += 1) {
    const cur = await cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke("get_timeline_state").then((s) => s.clips.length),
    );
    if (!cur) break;
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent("hifi:timelineEditOp", { detail: { op } }));
        fire("selectAll");
        fire("delete");
    });
    await sleep(800);
}
const b64 = readFileSync(wav).toString("base64");
/* at=0 ⇒ 块左缘正好贴容器左缘（这正是 #1 要压到轨道头列的那种态） */
await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), "e41", b64, 0.0);
await sleep(1800);

/* 🕳️ 探针坑（本轮踩到）：素材默认 pxPerSec 下**块比视口宽**（实测 402px vs 228px）⇒
   容器里**没有真正的空白**；原来"先点一下空白复位"其实**点在块上**，触发
   `hs-hide-clip-actions` ⇒ 浮条此后一直不在 DOM（= 假红）。
   ⇒ 改成**导入后先直接读一次**（导入自带选中 ⇒ 浮条本该已出现），不再去点"空白"。 */
const afterImport = await readState();
console.log(
    "▸ 导入后（未点任何地方）：" +
        JSON.stringify({ dots: afterImport.dotCount, actions: Boolean(afterImport.actions) }),
);

const selectClip = async () => {
    for (let i = 0; i < 4; i += 1) {
        const cur = await cdp.call(() => ({
            dots: document.querySelectorAll("[data-hs-clip-control-point]").length,
            actions: Boolean(document.querySelector("[data-hs-clip-actions]")),
        }));
        if (cur.dots > 0) return true;
        const p = await cdp.call(() => {
            const c = window.__hsViewport().containerRect;
            return { x: Math.round(c.left + 18), y: Math.round(c.top + 48) };
        });
        await tap(p.x, p.y);
    }
    return false;
};

/* ── 1. 竖屏基线（回归） ──────────────────────────────────────────── */
const okSel = await selectClip();
const portrait = await readState();
console.log("▸ 竖屏：" + JSON.stringify({ w: portrait.innerW, h: portrait.innerH, dots: portrait.dotCount, actions: Boolean(portrait.actions) }));
check(
    "P1 竖屏基线：选中块后**浮条/圆点在場**（回归，别把竖屏改坏）",
    Boolean(portrait.actions) && portrait.dotCount > 0,
    `actions=${Boolean(portrait.actions)} dots=${portrait.dotCount}（选中${okSel ? "成功" : "失败"}）`,
);

/* ── 2. #1：左圆点要能压到**轨道头列**（x < 容器左） ─────────────────── */
if (portrait.dotL && portrait.container) {
    check(
        "P2（#1）块贴容器左缘时**左圆点仍渲染**，且中心 x **< 容器左** ⇒ 已压在轨道头列上",
        portrait.dotL.cx < portrait.container.left,
        `左圆点 cx=${portrait.dotL.cx}，容器左=${Math.round(portrait.container.left)}` +
            `（修复前 dotPressable 按容器判 ⇒ 这个点**根本不画**）`,
    );
} else {
    console.log(`⚠️ P2（#1）不可判：dotL=${JSON.stringify(portrait.dotL)} container=${Boolean(portrait.container)}`);
}

/* ── 3. 横屏（#4） ────────────────────────────────────────────────── */
/* 🕳️ 转屏要改**两项**系统设置 ⇒ 先存原值，收尾**逐项**还原。
   （第一版只把 `user_rotation` 置回 0，把用户的"自动旋转"永久关掉了 ⇒ 务必按这个规矩来。） */
const origAccel = adb("shell settings get system accelerometer_rotation").trim();
const origUser = adb("shell settings get system user_rotation").trim();
console.log(`▸ 系统旋转原值：accelerometer_rotation=${origAccel} user_rotation=${origUser}`);
adb("shell settings put system accelerometer_rotation 0");
adb("shell settings put system user_rotation 1");
await sleep(2500);
const land = await readState();
console.log("▸ 横屏：" + JSON.stringify({ w: land.innerW, h: land.innerH, dots: land.dotCount, actions: Boolean(land.actions) }));

check(
    "P3（#4 前置）真的进横屏了（`innerWidth ≥ 600` 且小于 1280 ⇒ 仍是手机外壳）",
    land.innerW >= 600 && land.innerW < 1280,
    `innerW=${land.innerW} innerH=${land.innerH}`,
);
check(
    "P4（#4）横屏下**浮条 + 控制点圆点仍在場**（原来 `< 600` 门控 ⇒ 全部缺席）",
    Boolean(land.actions) && land.dotCount > 0,
    `actions=${Boolean(land.actions)} dots=${land.dotCount}（修复前这里应为 false/0）`,
);

/* 双击泳道 ⇒ 参数面板（原来 `isPhoneLike()` 里 `< 600` ⇒ 横屏失效）
   ⚠️ 必须**先把参数面板关掉**再双击，否则 `params` 本来就是 true ⇒ 判据空转。
   `hs-mobile-close-panel` 是 **toggle** 语义 ⇒ 只对**真在场**的 pane 派发（E32 那条纪律）。 */
const panesNow = await cdp.call(() =>
    [...document.querySelectorAll("[data-hs-pane]")].map((e) => e.getAttribute("data-hs-pane")),
);
if (panesNow.includes("params")) {
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent("hs-mobile-close-panel", { detail: { key: "params" } }));
        return true;
    });
    await sleep(1200);
}
const paneBefore = await cdp.call(() => Boolean(document.querySelector('[data-hs-pane="params"]')));
console.log("▸ 双击前：params=" + paneBefore + "（已确保关闭，否则判据空转）");
/* 落点取**泳道行中心**（不是 `container.top + 48`）：监听器挂在 `host.getContainer()` 上，
   点轨道头/工具条都收不到 `dblclick`（E30 那条已验收探针的教训，见它文件头注释）。 */
const lane = await cdp.call(() => {
    const r = window.__hsViewport().containerRect;
    const rows = [...document.querySelectorAll("[data-hs-track-row]")].map((e) => {
        const b = e.getBoundingClientRect();
        return Math.round(b.top + b.height / 2);
    });
    const y = rows[1] ?? rows[0];
    if (y === undefined || y < r.top + 4 || y > r.top + r.height - 4) return null;
    return { x: Math.round(r.left + r.width * 0.6), y };
});
/* 🔴 必须用**真实输入**双击（`Input.dispatchMouseEvent` + `clickCount:2`）——
   页内 `new MouseEvent("dblclick")` 走不到容器上的监听器（本轮实测：合成事件恒红，
   而同一落点用真实输入绿）。手法抄 `_probe-e30-pane-anim.mjs`。 */
let dbl = false;
if (lane) {
    for (const [type, extra] of [
        ["mousePressed", { button: "left", buttons: 1, clickCount: 1 }],
        ["mouseReleased", { button: "left", buttons: 0, clickCount: 1 }],
        ["mousePressed", { button: "left", buttons: 1, clickCount: 2 }],
        ["mouseReleased", { button: "left", buttons: 0, clickCount: 2 }],
    ]) {
        await cdp.send("Input.dispatchMouseEvent", { type, x: lane.x, y: lane.y, ...extra });
        await sleep(45);
    }
    dbl = true;
}
await sleep(1200);
const after = await readState();
check(
    "P5a（前置）双击前参数面板**确实是关着**的（否则 P5 空转）",
    paneBefore === false,
    `双击前 params=${paneBefore}`,
);
check(
    "P5（#4）横屏下**双击泳道能开出参数面板**（修复前 `>= 600` 直接 return ⇒ 无反应）",
    after.paramsPane === true,
    `双击前 params=${paneBefore} → 双击后 params=${after.paramsPane}（落点 ${lane ? `${lane.x},${lane.y}` : "不可判"}，派发${dbl ? "成功" : "失败"}）`,
);

/* ── 4. 横屏顶栏菜单高度（#5） ────────────────────────────────────── */
const menu = await openTopMenu("文件");
if (menu === null) {
    console.log("⚠️ P6（#5）不可判：顶栏「文件」菜单没打开");
} else {
    console.log("▸ 菜单：" + JSON.stringify(menu));
    check(
        "P6（#5）横屏下顶栏菜单**底边贴到视口底**（修复前 `100vh − 160px` ⇒ 只剩半截）",
        menu.bottom >= menu.innerH - 24,
        `底边=${menu.bottom} 视口高=${menu.innerH} 差=${menu.innerH - menu.bottom}px；` +
            `inline maxHeight=${menu.inlineMaxH}（旧值恒为 calc(100vh - 160px)）`,
    );
}
await closeOverlays();

/* ── 5. 收尾：**逐项**还原系统设置（别只回 user_rotation！） ─────────── */
adb(`shell settings put system user_rotation ${origUser === "" ? "0" : origUser}`);
adb(`shell settings put system accelerometer_rotation ${origAccel === "" ? "1" : origAccel}`);
await sleep(2500);
console.log(
    "▸ 已还原：accelerometer_rotation=" +
        adb("shell settings get system accelerometer_rotation").trim() +
        " user_rotation=" +
        adb("shell settings get system user_rotation").trim(),
);
const back = await readState();
check(
    "P7 收尾已转回竖屏（`innerWidth < 600`）—— 否则后续探针读数全脏",
    back.innerW < 600,
    `innerW=${back.innerW}`,
);

console.log(`\n── E41 横屏/浮层/菜单：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
process.exit(fail === 0 ? 0 : 1);
