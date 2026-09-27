import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
try { await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); } catch {}
const view = () => cdp.call(() => { const v = window.__hsParamViewport ? window.__hsParamViewport() : null; return v ? { px: Math.round(v.pxPerSec), sl: Math.round(v.scrollLeft), rect: v.scrollerRect } : null; });
const v0 = await view();
console.log("起始:", JSON.stringify(v0));
const cx = Math.round(v0.rect.left + v0.rect.width / 2), cy = Math.round(v0.rect.top + v0.rect.height / 2);
// 反向捏合（从 300 收到 90），每步后读 debug
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [ { id: 0, x: cx - 150, y: cy, radiusX: 6, radiusY: 6, force: 1 }, { id: 1, x: cx + 150, y: cy, radiusX: 6, radiusY: 6, force: 1 } ] });
for (let i = 1; i <= 6; i++) {
  const s = 300 - (210 * i) / 6;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [ { id: 0, x: cx - s / 2, y: cy, radiusX: 6, radiusY: 6, force: 1 }, { id: 1, x: cx + s / 2, y: cy, radiusX: 6, radiusY: 6, force: 1 } ] });
  await sleep(60);
}
console.log("捏合中:", JSON.stringify(await cdp.call(() => window.__hsGestureDebug ?? null)), JSON.stringify(await view()));
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(500);
console.log("抬手后:", JSON.stringify(await view()));
cdp.close();
