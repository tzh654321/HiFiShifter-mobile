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
await cdp.call(async () => { window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "params" } })); await new Promise((r) => setTimeout(r, 2800)); });
const host = await cdp.call(() => { const el = document.querySelector("[data-piano-roll-canvas]"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
console.log("宿主：" + JSON.stringify(host));
if (host) {
  const x0 = host.x + 20, y0 = host.y + Math.round(host.h * 0.5);
  await touch("touchStart", [{ id: 0, x: x0, y: y0 }]);
  await sleep(160);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [{ id: 0, x: x0 + i * 12, y: y0 }]); await sleep(60); }
  await touch("touchEnd", []);
  await sleep(1500);
}
console.log("已拖动");
cdp.close();
