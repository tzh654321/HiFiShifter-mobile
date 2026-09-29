import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, d) => console.log(`${ok ? "✅" : "🔴"} ${n}${d ? "\n     " + d : ""}`);
// 造分屏：轨道 + 参数（用视图菜单真触摸）
const menu = async (label) => {
  const b = await cdp.call((lb) => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === lb);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, label);
  if (!b) return false;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: b.x, y: b.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(60); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(900);
  return true;
};
const pick = async (prefix) => {
  const b = await cdp.call((pfx) => {
    const el = [...document.querySelectorAll("[role=menuitem],button,div")].find((x) => (x.textContent || "").replace(/[✓\s]/g, "").startsWith(pfx) && x.getBoundingClientRect().height < 60);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, prefix);
  if (!b) return false;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: b.x, y: b.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(60); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(1600);
  return true;
};
// 确保分屏
const splitChildren = () => cdp.call(() => {
  const box = document.querySelector('[data-hs-mobile-split="1"]');
  if (!box) return null;
  return { children: box.children.length, heights: [...box.children].map((c) => Math.round(c.getBoundingClientRect().height)), boxH: Math.round(box.getBoundingClientRect().height) };
});
let st = await splitChildren();
console.log("初始：" + JSON.stringify(st));
if (!st || st.children < 2) {
  await menu("视图"); await pick("参数面板");
}
st = await splitChildren();
console.log("分屏后：" + JSON.stringify(st));
// 找手柄：参数拍数栏（data-hs-time-ruler="params"）
const handle = await cdp.call(() => {
  const el = document.querySelector('[data-hs-time-ruler="params"]') ?? document.querySelector('[data-hs-split-handle]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.getAttribute("data-hs-time-ruler") || el.getAttribute("data-hs-split-handle") };
});
console.log("手柄：" + JSON.stringify(handle));
if (handle && st && st.children >= 2) {
  const h0 = st.heights[0];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: handle.x, y: handle.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(80);
  const samples = [];
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 0, x: handle.x, y: handle.y - i * 12, radiusX: 6, radiusY: 6, force: 1 }] });
    await sleep(70);
    const s = await splitChildren();
    samples.push(s ? s.heights[0] : null);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  console.log("拖动中上块高度采样：" + JSON.stringify(samples));
  const monotonic = samples.every((v, i) => i === 0 || v === null || samples[i-1] === null || v <= samples[i-1] + 1);
  check("I-2 拖动分屏手柄时高度**跟着手指连续变化**（不再被重置）", samples.filter((v) => v !== null).length >= 5 && monotonic && samples[samples.length-1] < h0, `起始 ${h0} → 采样 ${JSON.stringify(samples)}`);
}
cdp.close();
