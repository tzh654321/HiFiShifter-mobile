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
  await sleep(700);
};
const count = (tag) => {
  const log = adb("logcat -d -t 800").split("\n").filter((l) => /ClipboardService/.test(l));
  console.log(`   ${tag}: ${log.length} 次`);
  return log.length;
};
const panels = () => cdp.call(() => ({
  timeline: Boolean(document.querySelector('[data-hs-surface="timeline"]')),
  params: Boolean(document.querySelector('[data-piano-roll-canvas]')),
}));
console.log("面板=" + JSON.stringify(await panels()));
adb("logcat -c");
await sleep(12000);
console.log("① 仅轨道面板，静置 12s："); count("剪贴板访问");

// 打开参数面板（视图菜单，真触摸）
const trig = await cdp.call(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "视图");
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await tap(trig.x, trig.y);
await sleep(1000);
const item = await cdp.call(() => {
  const it = [...document.querySelectorAll("[role=menuitem]")].find((x) => (x.textContent || "").replace(/[✓\s]/g, "").startsWith("参数面板"));
  if (!it) return null;
  const r = it.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (item) { await tap(item.x, item.y); await sleep(2200); }
console.log("面板=" + JSON.stringify(await panels()));
adb("logcat -c");
await sleep(12000);
console.log("② 参数面板可见，静置 12s："); count("剪贴板访问");
cdp.close();
