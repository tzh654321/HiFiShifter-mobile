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
  return { len: edit.length, nonZero: edit.filter((v) => typeof v === "number" && v !== 0).length };
};
const before = await readParam();
console.log("拖前：" + JSON.stringify(before));
// 用**合成 PointerEvent** 在参数画布上拖（内核手势可能只认 pointer）
const r = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cs = [...document.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }))
    .filter((x) => x.r.width > 80 && x.r.height > 60).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const hit = cs[0];
  if (!hit) return { err: "no-canvas" };
  const x0 = hit.r.left + 20, y0 = hit.r.top + hit.r.height * 0.5;
  const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 301, isPrimary: true, pointerId2: 301, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  hit.c.dispatchEvent(ev("pointerdown", x0, y0));
  await wait(140);
  for (let i = 1; i <= 26; i++) {
    hit.c.dispatchEvent(ev("pointermove", x0 + i * 10, y0 + Math.sin(i / 2) * 12));
    await wait(50);
  }
  hit.c.dispatchEvent(ev("pointerup", x0 + 260, y0));
  await wait(800);
  return { canvas: [Math.round(hit.r.left), Math.round(hit.r.top), Math.round(hit.r.width), Math.round(hit.r.height)], done: true };
});
console.log("合成 pointer 拖动：" + JSON.stringify(r));
await sleep(2500);
const after = await readParam();
console.log("拖后：" + JSON.stringify(after));
console.log(Math.abs(after.nonZero - before.nonZero) > 10 ? "✅ 合成 PointerEvent 拖动**生效**（非零帧变化 " + before.nonZero + "→" + after.nonZero + "）" : "🔴 仍无变化 ⇒ 内核不接合成 pointer，或画布坐标/命中区不对");
cdp.close();
