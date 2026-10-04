/**
 * ① 视觉 + 量化证据：控制点 / 长按提示窗 的**层级**（应盖住轨道头列与拍数栏）。
 *
 * 前置：`_dbg-layer-restore.mjs` 已把 pxPerSec 缩到 ~78、scrollLeft 归 0
 * （2s 块 ≈ 156px < 视口 228px ⇒ 左右两点都在容器内 ⇒ **两点都会画**）。
 * 这里把块放到 t=0.5（左缘 171 / 右缘 327，两点分别落在 161 / 337）⇒ 长按左点。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Cdp } from "./lib/cdp.mjs";

const OUT = "D:/hifishifter-out";
const serial = process.argv[2] ?? "221deeb";
const wav = "D:/Temp/hs-tone.wav";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9243 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9243 });
await cdp.send("Runtime.enable");

const touch = (kind, pts) =>
    cdp.send("Input.dispatchTouchEvent", { type: kind, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
const shot = (name) => {
    execSync(`adb -s ${serial} exec-out screencap -p > "${OUT}\\${name}"`, { shell: "cmd.exe" });
};

const read = () =>
    cdp.call(() => {
        const box = (n) => {
            if (!n) return null;
            const r = n.getBoundingClientRect();
            return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const v = window.__hsViewport ? window.__hsViewport() : null;
        const cr = v ? v.containerRect : null;
        const dots = [...document.querySelectorAll("[data-hs-clip-control-point]")].map((n) => ({
            side: n.getAttribute("data-hs-clip-control-point"),
            mode: n.getAttribute("data-hs-control-mode"),
            box: box(n),
            z: getComputedStyle(n.parentElement).zIndex,
        }));
        /* 轨道头列：取第一行轨道头元素的右边界 */
        const row = document.querySelector("[data-hs-track-row]");
        const rowBox = box(row);
        /* 拍数栏 */
        const ruler = document.querySelector("[data-hs-time-ruler]") ?? document.querySelector("[data-hs-ruler]");
        const hints = [...document.querySelectorAll("[data-hs-edge-longpress-hint]")].map((n) => box(n));
        return {
            container: cr ? { l: Math.round(cr.left), t: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
            rowBox,
            ruler: box(ruler),
            dots,
            hints,
            hintOn: document.querySelector("[data-hs-edge-longpress-hint]") !== null,
        };
    });

/* 1) 清空 + 导入到 t=0.5 */
await cdp.call(() => window.__hsNewProject && window.__hsNewProject());
await sleep(1200);
await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), "hz", readFileSync(wav).toString("base64"), 0.5);
await sleep(1800);

/* 2) 选中：点块中心（后端坐标换算） */
const clips = await cdp.call(async () => {
    const st = await window.__TAURI_INTERNALS__.invoke("get_timeline_state");
    return (st.tracks || []).flatMap((tk, ti) =>
        (st.clips || [])
            .filter((c) => c.track_id === tk.id)
            .map((c) => ({ trackIndex: ti, startSec: c.start_sec, lengthSec: c.length_sec })),
    );
});
const s0 = await cdp.call(() => {
    const v = window.__hsViewport();
    return { cLeft: Math.round(v.containerRect.left), cTop: Math.round(v.containerRect.top), px: v.pxPerSec, sl: v.scrollLeft, rh: v.rowHeight };
});
const c0 = clips[0];
const tx = Math.round(s0.cLeft + c0.startSec * s0.px - s0.sl + (c0.lengthSec * s0.px) / 2);
const ty = Math.round(s0.cTop + c0.trackIndex * s0.rh + s0.rh / 2);
console.log("点块中心 =", tx, ty, " clips =", JSON.stringify(clips));
await touch("touchStart", [{ x: tx, y: ty }]);
await sleep(90);
await touch("touchEnd", []);
await sleep(800);
console.log("选中后:", JSON.stringify(await read(), null, 1));
shot("_e40-A-selected.png");

/* 3) 长按左控制点 ⇒ 提示窗出现 */
const dot = await cdp.call(() => {
    const d = document.querySelector('[data-hs-clip-control-point="left"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("左控制点 =", JSON.stringify(dot));
if (dot) {
    await touch("touchStart", [{ x: dot.x, y: dot.y }]);
    await sleep(750);
    const st = await read();
    console.log("长按中:", JSON.stringify({ hintOn: st.hintOn, hints: st.hints, ruler: st.ruler, rowBox: st.rowBox }, null, 1));
    shot("_e40-B-hold.png");
    await touch("touchEnd", []);
} else {
    console.log("（仍无左控制点）");
}

console.log("done");
cdp.close();
