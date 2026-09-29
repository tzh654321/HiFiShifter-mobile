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
const invoke = (cmd, args) => cdp.call((c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0,110) })), cmd, args);
const readParam = async () => {
  const res = await invoke("get_param_frames", { trackId: "track_main", param: "pitch", startFrame: 0, frameCount: 1200, stride: 1 });
  const edit = Array.isArray(res?.edit) ? res.edit : [];
  return { nonZero: edit.filter((v) => typeof v === "number" && v !== 0).length, first: edit.findIndex((v) => typeof v === "number" && v !== 0) };
};
const host = await cdp.call(() => {
  const el = document.querySelector("[data-piano-roll-canvas]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(el).pointerEvents };
});
console.log("真宿主：" + JSON.stringify(host));
const before = await readParam();
console.log("拖前：" + JSON.stringify(before));
if (host) {
  const x0 = host.x + 20, y0 = host.y + Math.round(host.h * 0.5);
  await touch("touchStart", [{ id: 0, x: x0, y: y0 }]);
  await sleep(160);
  for (let i = 1; i <= 26; i++) { await touch("touchMove", [{ id: 0, x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 12) }]); await sleep(55); }
  await touch("touchEnd", []);
  await sleep(2500);
  console.log("已用**真实触摸**在真宿主上拖动 260px");
}
const after = await readParam();
console.log("拖后：" + JSON.stringify(after));
const d = Math.abs(after.nonZero - before.nonZero);
console.log(d > 5 ? `✅ 真实触摸拖动**生效**（非零帧 ${before.nonZero} → ${after.nonZero}）` : `🔴 仍 Δ${d} ⇒ 需加日志确认事件是否到达 onCanvasPointerDown`);
cdp.close();
