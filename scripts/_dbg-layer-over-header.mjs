/**
 * ① 视觉证据：让块左缘滑到**轨道头列**下方，长按左控制点 ⇒ 看"控制点 + 长按提示"
 * 是否**压在轨道头列 / 拍数栏之上**（层级修复前它们被困在面板块里出不来）。
 *
 * 🕳️ 本机实测坑：
 *   · 块是 **canvas** 画的（DOM 无块元素）⇒ 几何只能读 `__hsViewport()` + `__hsClipProbe()`。
 *   · 视口（scrollLeft / pxPerSec）**跨进程持久化**（存进 UI 设置）⇒ 每次都先"复位到 0"。
 *   · 单指在**下方空白**横拖 = 平移：手指向左 ⇒ scrollLeft↑。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Cdp } from "./lib/cdp.mjs";

const OUT = "D:/hifishifter-out";
const serial = process.argv[2] ?? "221deeb";
const wav = "D:/Temp/hs-tone.wav";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9241 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9241 });
await cdp.send("Runtime.enable");

const touch = (kind, pts) =>
    cdp.send("Input.dispatchTouchEvent", { type: kind, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
const shot = (name) => {
    execSync(`adb -s ${serial} exec-out screencap -p > "${OUT}\\${name}"`, { shell: "cmd.exe" });
};

const snap = () =>
    cdp.call(() => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const pr = window.__hsClipProbe ? window.__hsClipProbe() : null;
        const cr = vp ? vp.containerRect : null;
        const c = pr ? pr.clip : null;
        const l = c && vp && cr ? Math.round(cr.left + c.startSec * vp.pxPerSec - vp.scrollLeft) : null;
        const r = c && vp && cr ? Math.round(l + c.lengthSec * vp.pxPerSec) : null;
        return {
            clipLeft: l,
            clipRight: r,
            cLeft: cr ? Math.round(cr.left) : null,
            cTop: cr ? Math.round(cr.top) : null,
            cH: cr ? Math.round(cr.height) : null,
            cW: cr ? Math.round(cr.width) : null,
            scrollLeft: vp ? Math.round(vp.scrollLeft) : null,
            pxPerSec: vp ? Math.round(vp.pxPerSec) : null,
            rowHeight: vp && vp.rowHeight ? Math.round(vp.rowHeight) : null,
            hasDot: Boolean(document.querySelector("[data-hs-clip-control-point]")),
        };
    });

/** 后端 clips（**未选中**也能拿位置；块的 DOM 是 canvas，没有元素可查）。 */
const readClips = () =>
    cdp.call(async () => {
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state');
        return (st.tracks || []).flatMap((tk, ti) =>
            ((st.clips || []).filter((c) => c.track_id === tk.id)).map((c) => ({
                id: c.id,
                trackIndex: ti,
                startSec: c.start_sec,
                lengthSec: c.length_sec,
            })),
        );
    });

/** **双指平移**（规格里的标准手势，任何位置可用；单指在空白区拖会撞上块/按钮）。
    dir>0 = 手指向右 ⇒ scrollLeft↓。 */
async function panTwoFinger(dir, px = 260) {
    const s0 = await snap();
    const cy = s0.cTop + 70;
    const a0 = s0.cLeft + 40;
    const b0 = s0.cLeft + 90;
    await touch("touchStart", [
        { x: a0, y: cy },
        { x: b0, y: cy },
    ]);
    await sleep(60);
    for (let k = 1; k <= 10; k += 1) {
        const d = (dir * px * k) / 10;
        await touch("touchMove", [
            { x: a0 + d, y: cy },
            { x: b0 + d, y: cy },
        ]);
        await sleep(30);
    }
    await touch("touchEnd", []);
    await sleep(340);
}

/** 双指捏合缩放（两指分开 = 放大 pxPerSec）。 */
async function pinchOut() {
    const s0 = await snap();
    const cx = s0.cLeft + s0.cW / 2;
    const cy = s0.cTop + 60;
    for (let k = 0; k <= 10; k += 1) {
        const d = 30 + 12 * k;
        await touch(k === 0 ? "touchStart" : "touchMove", [
            { x: cx - d, y: cy },
            { x: cx + d, y: cy },
        ]);
        await sleep(30);
    }
    await touch("touchEnd", []);
    await sleep(320);
}

/* 1) 清空 + 导入到 t=0 */
await cdp.call(() => window.__hsNewProject && window.__hsNewProject());
await sleep(1200);
await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), "hz", readFileSync(wav).toString("base64"), 0);
await sleep(1800);

/* 2) 视野复位：scrollLeft → 0（手指向右拖） */
for (let i = 0; i < 8; i += 1) {
    const s = await snap();
    if (s.scrollLeft === null || s.scrollLeft <= 6) break;
    await panTwoFinger(+1);
}
console.log("复位后:", JSON.stringify(await snap()));

/* 3) 放大一点（pxPerSec 10 → 更大） */
for (let i = 0; i < 4; i += 1) {
    const s = await snap();
    if (s.pxPerSec && s.pxPerSec >= 60) break;
    await pinchOut();
}
console.log("放大后:", JSON.stringify(await snap()));

/* 4) 选中：从**后端**读块位置（canvas 无 DOM），按视口换算成屏幕坐标点击 */
const rowH = (await snap()).rowHeight;
for (let i = 0; i < 6; i += 1) {
    const s = await snap();
    const clips = await readClips();
    if (!clips.length) { console.log('（后端没有块）'); break; }
    const c = clips[0];
    const x = Math.round(s.cLeft + c.startSec * s.pxPerSec - s.scrollLeft + (c.lengthSec * s.pxPerSec) / 2);
    const y = Math.round(s.cTop + c.trackIndex * rowH + rowH / 2);
    if (x < s.cLeft + 6 || x > s.cLeft + s.cW - 6) {
        console.log(`（块中心 x=${x} 不在视口 ${s.cLeft}…${s.cLeft + s.cW} ⇒ 先复位视野）`);
        await panTwoFinger(+1);
        continue;
    }
    await touch("touchStart", [{ x, y }]);
    await sleep(90);
    await touch("touchEnd", []);
    await sleep(650);
    if ((await snap()).hasDot) break;
}
console.log("选中后:", JSON.stringify(await snap()));

/* 5) 小步把块左缘推进轨道头列下方（scrollLeft 只需几十 px） */
for (let i = 0; i < 8; i += 1) {
    const s = await snap();
    const clips = await readClips();
    if (!clips.length) break;
    const leftEdge = Math.round(s.cLeft + clips[0].startSec * s.pxPerSec - s.scrollLeft);
    if (leftEdge < s.cLeft - 25) break;
    await panTwoFinger(-1, 120);
}
/* 5b) 平移会清选中 ⇒ 重新选一次 */
for (let i = 0; i < 6; i += 1) {
    const s = await snap();
    if (s.hasDot) break;
    const clips = await readClips();
    if (!clips.length) break;
    const c = clips[0];
    const x = Math.round(s.cLeft + c.startSec * s.pxPerSec - s.scrollLeft + (c.lengthSec * s.pxPerSec) / 2);
    const y = Math.round(s.cTop + c.trackIndex * rowH + rowH / 2);
    if (x < s.cLeft + 6 || x > s.cLeft + s.cW - 6) { break; }
    await touch("touchStart", [{ x, y }]);
    await sleep(90);
    await touch("touchEnd", []);
    await sleep(700);
}
const fin = await snap();
const finClips = await readClips();
const finLeft = finClips.length ? Math.round(fin.cLeft + finClips[0].startSec * fin.pxPerSec - fin.scrollLeft) : null;
console.log("就位后:", JSON.stringify({ ...fin, clipLeftEdgeNow: finLeft }), " （轨道头列 0…", fin.cLeft, "）");
shot("_e40-layer-left.png");

/* 6) 长按左控制点 ⇒ 提示窗出现（此刻浮层正压着轨道头列） */
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
    shot("_e40-layer-hold.png");
    await touch("touchEnd", []);
}

console.log("done");
cdp.close();
