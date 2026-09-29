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
const esc = async () => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(400);
  await cdp.call(() => { document.querySelectorAll("[data-hs-project-backdrop],[data-hs-metronome-backdrop],[data-hs-storage-backdrop]").forEach((b) => b.dispatchEvent(new MouseEvent("click", { bubbles: true }))); });
  await sleep(600);
};
const fire = async (which) => {
  await cdp.call((w) => window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: w } })), which);
  await sleep(1500);
  return cdp.call(() => {
    const d = document.querySelector("[role=dialog]");
    return { open: Boolean(d), text: d ? (d.innerText || "").replace(/\s+/g, " ").slice(0, 110) : "" };
  });
};
const g = await fire("snap-grid");
check("G-2a 吸附网格设置", g.open && /网格/.test(g.text), g.text.slice(0, 70));
await esc();
const s = await fire("split-transition");
check("G-2b 分割过渡设置", s.open, s.text.slice(0, 90));
await esc();
const m = await fire("metronome");
check("H 节拍器菜单", m.open && /细分/.test(m.text), m.text.slice(0, 70));
await esc();

// G-1：先切到轨道面板并确保有块，然后 **① 我的事件桥 vs ② 真实右键** 对比
const prep = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
  window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
  await wait(1800);
  let st = await inv("get_timeline_state", {});
  if (!(st.clips || []).length) {
    await inv("import_audio_item", { audioPath: "/sdcard/Download/test-rr.wav", trackId: null, startSec: 0, mediaAudioStreamIndex: null });
    await wait(2600);
    st = await inv("get_timeline_state", {});
  }
  const clip = (st.clips || [])[0];
  if (!clip) return null;
  await inv("select_clip", { clipId: clip.id });
  await wait(700);
  const vp = window.__hsViewport ? window.__hsViewport() : null;
  const host = document.querySelector('[data-hs-surface="timeline"]');
  const r = host.getBoundingClientRect();
  const x = r.left + (clip.start_sec - (vp?.scrollLeft ?? 0)) * (vp?.pxPerSec ?? 10) + 30;
  const y = r.top + (vp?.rowHeight ?? 48) * 0.5;
  return { id: clip.id, x: Math.round(Math.max(r.left + 8, Math.min(x, r.right - 8))), y: Math.round(y) };
});
console.log("▸ 准备：" + JSON.stringify(prep));
const hasMenu = () => cdp.call(() => {
  const el = [...document.querySelectorAll("div")].find((d) => {
    const t = d.innerText || "";
    const r = d.getBoundingClientRect();
    return /重命名/.test(t) && /删除|静音/.test(t) && r.height > 60 && r.height < 700;
  });
  return { present: Boolean(el), sample: el ? (el.innerText || "").replace(/\s+/g, " ").slice(0, 80) : null };
});
if (prep) {
  // ① 事件桥
  await cdp.call((p) => window.dispatchEvent(new CustomEvent("hs-open-clip-context-menu", { detail: { x: 120, y: 240, clipId: p.id } })), prep);
  await sleep(1500);
  const a = await hasMenu();
  check("G-1① 事件桥（带 clipId）能唤起右键菜单", a.present, JSON.stringify(a));
  await esc();
  // ② 真实右键（在块上派发 contextmenu）
  await cdp.call((p) => {
    const host = document.querySelector('[data-hs-surface="timeline"]');
    host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
  }, prep);
  await sleep(1500);
  const b = await hasMenu();
  check("G-1② 真实右键能唤起右键菜单（对照）", b.present, JSON.stringify(b));
}
cdp.close();
