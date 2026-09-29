import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ① 浮条**内层**（fixed 定位那个）到底在哪、多大
const bar = await cdp.call(() => {
  const outer = document.querySelector("[data-hs-clip-actions]");
  if (!outer) return null;
  const kids = [...outer.children].map((k) => {
    const r = k.getBoundingClientRect();
    return { tag: k.tagName, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], style: String(k.getAttribute("style") || "").slice(0, 90) };
  });
  return { kidCount: outer.children.length, kids };
});
console.log("① 浮条内层：" + JSON.stringify(bar));
// ② 合成 pointerdown 在左圆点上，看 mode 是否变化
const dot = await cdp.call(() => {
  const d = document.querySelector('[data-hs-clip-control-point="left"]');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("② 左圆点中心：" + JSON.stringify(dot));
if (dot) {
  const r2 = await cdp.call(async (p) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, clientX: x, clientY: y, button: 0 });
    window.dispatchEvent(ev("pointerdown", p.x, p.y));
    await wait(120);
    window.dispatchEvent(ev("pointermove", p.x + 3, p.y - 50));
    await wait(260);
    const d = document.querySelector('[data-hs-clip-control-point="left"]');
    const out = { mode: d?.getAttribute("data-hs-control-mode") ?? null, dragging: d?.getAttribute("data-hs-control-dragging") ?? null };
    window.dispatchEvent(ev("pointerup", p.x + 3, p.y - 50));
    return out;
  }, dot);
  console.log("② 合成 pointerdown 后：" + JSON.stringify(r2));
}
cdp.close();
