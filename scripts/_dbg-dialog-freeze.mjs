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
  await sleep(800);
};
const box = (label) => cdp.call((lb) => {
  const el = [...document.querySelectorAll("button,[role=menuitem],div")].find((x) => (x.textContent || "").trim() === lb || (x.textContent || "").trim().startsWith(lb));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, label);
const fileBtn = await box("文件");
if (fileBtn) await tap(fileBtn.x, fileBtn.y);
const item = await box("工程设置");
console.log("工程设置项：" + JSON.stringify(item));
if (item) await tap(item.x, item.y);
await sleep(2500);
// 抓 console（CDP 可能已超时；用 adb 侧日志兜底）
try {
  const ok = await cdp.call(() => ({ responded: true, dialog: Boolean(document.querySelector("[role=dialog]")) }));
  console.log("页面响应：" + JSON.stringify(ok));
} catch (e) {
  console.log("页面无响应（卡死复现）");
}
cdp.close();
