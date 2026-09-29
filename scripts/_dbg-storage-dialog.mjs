import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (x, y) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
};
const menuBtn = (label) => cdp.call((lb) => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === lb);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, label);
const itemBtn = (label) => cdp.call((lb) => {
  const el = [...document.querySelectorAll("[role=menuitem],button,div")].find((x) => (x.textContent || "").trim().startsWith(lb));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, label);
// 打开「选项」菜单 → 点「存储设置」
const opt = await menuBtn("选项");
if (opt) { await tap(opt.x, opt.y); }
const it = await itemBtn("存储设置");
console.log("存储设置项：" + JSON.stringify(it));
if (it) { await tap(it.x, it.y); await sleep(1200); }
try {
  const after = await cdp.call(() => ({ dialog: Boolean(document.querySelector("[role=dialog]")), text: (document.querySelector("[role=dialog]")?.innerText || "").replace(/\s+/g, " ").slice(0, 100) }));
  console.log("✅ 存储设置对话框：" + JSON.stringify(after));
} catch (e) {
  console.log("❌ 点存储设置后页面无响应（也卡死）");
}
cdp.close();
