import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args) => cdp.call((c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0,110) })), cmd, args);
const readParam = async () => {
  const res = await invoke("get_param_frames", { trackId: "track_main", param: "pitch", startFrame: 0, frameCount: 1200, stride: 1 });
  const edit = Array.isArray(res?.edit) ? res.edit : [];
  return { nonZero: edit.filter((v) => typeof v === "number" && v !== 0).length, head: edit.slice(0, 3) };
};
// 哪些 canvas 存在、哪个是交互宿主
const info = await cdp.call(() => {
  const host = document.querySelector("[data-piano-roll-canvas]");
  const all = [...document.querySelectorAll("canvas")].map((c) => {
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(c).pointerEvents, isHost: c === host };
  });
  const r = host?.getBoundingClientRect();
  return { hasHost: Boolean(host), hostRect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null, canvases: all };
});
console.log("canvas 清单：" + JSON.stringify(info));
const before = await readParam();
console.log("拖前：" + JSON.stringify(before));
// 在**真宿主**上拖动（合成 pointer）
const r = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const host = document.querySelector("[data-piano-roll-canvas]");
  if (!host) return { err: "no-host" };
  const rect = host.getBoundingClientRect();
  const x0 = rect.left + 20, y0 = rect.top + rect.height * 0.5;
  const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 401, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  host.dispatchEvent(ev("pointerdown", x0, y0));
  await wait(150);
  for (let i = 1; i <= 26; i++) { host.dispatchEvent(ev("pointermove", x0 + i * 10, y0 + Math.sin(i / 2) * 12)); await wait(50); }
  host.dispatchEvent(ev("pointerup", x0 + 260, y0));
  await wait(900);
  return { ok: true };
});
console.log("合成 pointer 拖动：" + JSON.stringify(r));
await sleep(2500);
const after = await readParam();
console.log("拖后：" + JSON.stringify(after));
console.log(Math.abs(after.nonZero - before.nonZero) > 5 ? "✅ 拖动**生效**（非零帧 " + before.nonZero + " → " + after.nonZero + "）" : "🔴 仍 Δ0 ⇒ 需给宿主 pointerdown 加日志");
cdp.close();
