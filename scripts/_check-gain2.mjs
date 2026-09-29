import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })) });
const vol = () => cdp.call(async () => {
  const st = await window.__TAURI_INTERNALS__.invoke("get_timeline_state", {}).catch(() => null);
  const t = (st?.tracks || [])[0];
  const el = document.querySelector("[data-track-gain-value]");
  return { volume: t?.volume ?? null, label: el ? (el.textContent || "").trim() : null };
});
// 切轨道面板
await cdp.call(async () => { window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } })); await new Promise((r) => setTimeout(r, 1800)); });
const k = await cdp.call(() => {
  const el = document.querySelector("[data-track-volume-knob]");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("拖前：" + JSON.stringify(await vol()));
await touch("touchStart", [{ id: 0, x: k.x, y: k.y }]);
await sleep(400);
for (let i = 1; i <= 5; i++) { await touch("touchMove", [{ id: 0, x: k.x, y: k.y - i * 6 }]); await sleep(70); }
await touch("touchEnd", []);
await sleep(1800);
console.log("拖后：" + JSON.stringify(await vol()));
cdp.close();
