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
const box = (label) => cdp.call((lb) => {
  const el = [...document.querySelectorAll("button,[role=menuitem]")].find((x) => (x.textContent || "").trim() === lb);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, label);
const f = await box("文件");
if (f) await tap(f.x, f.y);
const item = await cdp.call(() => {
  const el = [...document.querySelectorAll("[role=menuitem],button,div")].find((x) => (x.textContent || "").trim().startsWith("工程设置"));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("工程设置项 = " + JSON.stringify(item));
if (item) await tap(item.x, item.y);
await sleep(2500);
console.log("点击已发出（不等 evaluate）");
cdp.close();
