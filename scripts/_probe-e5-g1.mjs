import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, d) => console.log(`${ok ? "✅" : "🔴"} ${n}${d ? "\n     " + d : ""}`);
// 准备：轨道面板 + 块 + **前端选中**（点块，而不是后端 select_clip —— 浮条要求前端 store）
const prep = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
  window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
  await wait(1800);
  let st = await inv("get_timeline_state", {});
  if (!(st.clips || []).length) {
    await inv("import_audio_item", { audioPath: "/sdcard/Download/test-rr.wav", trackId: null, startSec: 0, mediaAudioStreamIndex: null });
    await wait(2600); st = await inv("get_timeline_state", {});
  }
  const clip = (st.clips || [])[0];
  const vp = window.__hsViewport ? window.__hsViewport() : null;
  /* ⚠️ 必须用**内核画布**的 rect，而不是面板（`[data-hs-surface="timeline"]`）的 ——
     面板含左侧轨道头列（实测 canvas 从 x=132 起），用面板算出来的 x 会落在轨道头上，
     点了个寂寞（E5/E6/G-1 之前全"失败"就是栽在这里）。 */
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }));
  const best = canvases.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  const r = best ? best.r : document.querySelector('[data-hs-surface="timeline"]').getBoundingClientRect();
  const x = r.left + (clip.start_sec - (vp?.scrollLeft ?? 0)) * (vp?.pxPerSec ?? 10) + 40;
  const y = r.top + (vp?.rowHeight ?? 48) * 0.5;
  return { id: clip.id, x: Math.round(Math.max(r.left + 8, Math.min(x, r.right - 8))), y: Math.round(y) };
});
console.log("准备：" + JSON.stringify(prep));
// 真触摸点块 ⇒ 前端选中
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: prep.x, y: prep.y, radiusX: 6, radiusY: 6, force: 1 }] });
await sleep(60);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(1500);
const dots = await cdp.call(() => {
  const l = document.querySelector('[data-hs-clip-control-point="left"]');
  const r = document.querySelector('[data-hs-clip-control-point="right"]');
  const clipEl = document.querySelector('[data-hs-clip-actions]');
  const rect = (e) => (e ? e.getBoundingClientRect() : null);
  const lr = rect(l), rr = rect(r);
  return {
    leftDot: lr ? [Math.round(lr.left), Math.round(lr.top), Math.round(lr.width)] : null,
    rightDot: rr ? [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width)] : null,
    barPresent: Boolean(clipEl),
    barVisible: clipEl ? clipEl.getBoundingClientRect().width > 4 : false,
  };
});
console.log("控制点/浮条：" + JSON.stringify(dots));
check("E5-a 两个**圆点**已渲染（块外）", Boolean(dots.leftDot && dots.rightDot), JSON.stringify(dots));
check("E5-b 圆点直径约 14px（圆点而非竖条）", dots.leftDot ? dots.leftDot[2] >= 12 && dots.leftDot[2] <= 18 : false, JSON.stringify(dots.leftDot));
// E5-c 按下控制点 ⇒ 浮条收起（用真触摸点圆点位置上方的块外侧）
if (dots.leftDot) {
  const gx = dots.leftDot[0] + 7, gy = dots.leftDot[1] + 7;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: gx, y: gy, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(80);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 0, x: gx + 4, y: gy - 40, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(200);
  const mid = await cdp.call(() => {
    const d = document.querySelector('[data-hs-clip-control-point="left"]');
    const bar = document.querySelector('[data-hs-clip-actions]');
    return {
      mode: d?.getAttribute('data-hs-control-mode') ?? null,
      y: d ? Math.round(d.getBoundingClientRect().top) : null,
      barVisible: bar ? bar.getBoundingClientRect().width > 4 : false,
    };
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(400);
  const after = await cdp.call(() => ({
    mode: document.querySelector('[data-hs-clip-control-point="left"]')?.getAttribute('data-hs-control-mode') ?? null,
  }));
  console.log("按下并上划后：" + JSON.stringify(mid) + " 松手后 mode=" + after.mode);
  check("E5-c 上划后圆点带**淡入淡出图标**（mode=fade）", mid.mode === "fade", "mode=" + mid.mode);
  check("E5-d 按下控制点后**浮条收起**", mid.barVisible === false, "barVisible=" + mid.barVisible);
  check("E5-e 松手后回到默认态", after.mode === "none", "mode=" + after.mode);
}
// G-1：日志 + 菜单
await cdp.call((p) => window.dispatchEvent(new CustomEvent("hs-open-clip-context-menu", { detail: { x: 100, y: 300, clipId: p.id } })), prep);
await sleep(1500);
const g1log = adb("logcat -d -t 300").split("\n").filter((l) => /\[g1\]/.test(l)).slice(-3);
console.log("G-1 日志：" + (g1log.length ? g1log.map((l) => l.trim().slice(0, 120)).join(" | ") : "（无）"));
const g1menu = await cdp.call(() => {
  const el = [...document.querySelectorAll("div")].find((d) => /重命名/.test(d.innerText || "") && (d.innerText || "").length < 200 && d.getBoundingClientRect().height > 60);
  return { present: Boolean(el), sample: el ? (el.innerText || "").replace(/\s+/g, " ").slice(0, 70) : null };
});
check("G-1 事件派发后右键菜单出现", g1menu.present, JSON.stringify(g1menu));
cdp.close();
