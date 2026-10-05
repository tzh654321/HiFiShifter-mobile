/**
 * ① 证据 + **视口复位**。
 *
 * 背景：控制点浮层有"按不到就不画"的规则（`dotPressable`），而视口（scrollLeft /
 * pxPerSec）**跨进程持久化** —— 前面的探针把它缩到了 pxPerSec=201，块(402px)远宽于
 * 视口(228px) ⇒ 两点都在容器外 ⇒ 一个都不画。这里：
 *   1) 把 pxPerSec 缩回 ~10、scrollLeft 归 0（**恢复用户原来的视野**）；
 *   2) 导入 2s 素材到 t=2 ⇒ 块左缘 152、右缘 172，两点都落在可点范围内 ⇒ 都会画；
 *   3) 长按左控制点 ⇒ 提示窗出现，**同时量化**提示窗/圆点 与 轨道头列/拍数栏 的矩形关系。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Cdp } from "./lib/cdp.mjs";

const OUT = "D:/code/HiFiShifter/hifishifter-out";
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

const vp = () =>
    cdp.call(() => {
        const v = window.__hsViewport ? window.__hsViewport() : null;
        const cr = v ? v.containerRect : null;
        return {
            scrollLeft: v ? Math.round(v.scrollLeft) : null,
            pxPerSec: v ? Math.round(v.pxPerSec) : null,
            cLeft: cr ? Math.round(cr.left) : null,
            cTop: cr ? Math.round(cr.top) : null,
            cW: cr ? Math.round(cr.width) : null,
            cH: cr ? Math.round(cr.height) : null,
            rowHeight: v && v.rowHeight ? Math.round(v.rowHeight) : null,
        };
    });

/** 双指平移：dir>0 手指向右 ⇒ scrollLeft↓ */
async function pan(dir, px = 300) {
    const s = await vp();
    const cy = s.cTop + 70;
    const a = s.cLeft + 40;
    const b = s.cLeft + 90;
    await touch("touchStart", [{ x: a, y: cy }, { x: b, y: cy }]);
    await sleep(60);
    for (let k = 1; k <= 10; k += 1) {
        const d = (dir * px * k) / 10;
        await touch("touchMove", [{ x: a + d, y: cy }, { x: b + d, y: cy }]);
        await sleep(30);
    }
    await touch("touchEnd", []);
    await sleep(340);
}

/** 双指捏合：out=true 放大 pxPerSec（两指分开），out=false 缩小。
    ⚠️ 两指**起始就必须都落在时间线容器内** —— 把一指放到轨道头列上会退化成两个
    单指手势，缩放根本不发生（实测：12 次"缩小"只从 201 → 163）。 */
async function pinch(out) {
    const s = await vp();
    const cx = s.cLeft + s.cW / 2;
    const cy = s.cTop + 60;
    const d0 = out ? 30 : 90;
    const d1 = out ? 90 : 28;
    for (let k = 0; k <= 10; k += 1) {
        const d = d0 + ((d1 - d0) * k) / 10;
        await touch(k === 0 ? "touchStart" : "touchMove", [{ x: cx - d, y: cy }, { x: cx + d, y: cy }]);
        await sleep(34);
    }
    await touch("touchEnd", []);
    await sleep(380);
}

/* 1) 缩到 pxPerSec ≈ 90（够窄：2s 块 ≈ 180px，两点都能落在视口内） */
for (let i = 0; i < 20; i += 1) {
    const s = await vp();
    if (s.pxPerSec === null || s.pxPerSec <= 95) break;
    await pinch(false);
}
/* 2) scrollLeft 归 0 */
for (let i = 0; i < 10; i += 1) {
    const s = await vp();
    if (s.scrollLeft === null || s.scrollLeft <= 6) break;
    await pan(+1);
}
console.log("复位后:", JSON.stringify(await vp()));
shot("_e40-A-restored.png");
cdp.close();
