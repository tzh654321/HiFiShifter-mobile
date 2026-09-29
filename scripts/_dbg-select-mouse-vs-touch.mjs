import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => cdp.call(() => {
  const bar = document.querySelector("[data-hs-clip-actions]");
  const dots = document.querySelectorAll("[data-hs-clip-control-point]").length;
  const host = document.querySelector('[data-hs-surface="timeline"]');
  const canvases = [...document.querySelectorAll("canvas")].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  // 取**与视口同宽**的那个（主曲线画布）：宽≈228
  const main = canvases.find((c) => Math.abs(c[2] - 228) < 6) ?? canvases[0];
  return { bar: Boolean(bar), dots, main, host: host ? [Math.round(host.getBoundingClientRect().left), Math.round(host.getBoundingClientRect().top)] : null };
});
const s0 = await state();
console.log("初态：" + JSON.stringify(s0));
const x = s0.main[0] + 60, y = s0.main[1] + 55;
console.log("点击坐标：" + x + "," + y);
// ① 鼠标点击
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
await sleep(80);
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
await sleep(1500);
const s1 = await state();
console.log("① 鼠标点击后：" + JSON.stringify(s1));
// ② 真触摸点击
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }] });
await sleep(90);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(1500);
const s2 = await state();
console.log("② 真触摸点击后：" + JSON.stringify(s2));
console.log("\n判读：若 ① 出浮条而 ② 不出 ⇒ 触摸路径的问题；若都不出 ⇒ 选中链路/内核问题");
cdp.close();
