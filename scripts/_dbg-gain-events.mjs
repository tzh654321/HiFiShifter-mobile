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
const knob = await cdp.call(() => {
  const k = document.querySelector('[data-track-volume-knob]');
  const r = k.getBoundingClientRect();
  window.__hsEv = [];
  const rec = (t) => (e) => window.__hsEv.push({ t, ty: e.type, x: Math.round(e.clientX), y: Math.round(e.clientY), target: (e.target && e.target.closest && e.target.closest('[data-track-volume-knob]')) ? 'knob' : 'other', cancelable: e.cancelable });
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    window.addEventListener(t, rec(t), true);
  }
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("旋钮：" + JSON.stringify(knob));
await touch('touchStart', [{ id: 0, x: knob.x, y: knob.y }]);
await sleep(380);
for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ id: 0, x: knob.x, y: knob.y - i * 7 }]); await sleep(35); }
await touch('touchEnd', []);
await sleep(900);
const ev = await cdp.call(() => (window.__hsEv || []).map((e) => `${e.t}${e.target === 'knob' ? '(knob)' : ''}@${e.y}`));
console.log("事件序列：" + JSON.stringify(ev));
const vol = await cdp.call(async () => {
  const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
  return (st.tracks || [])[0]?.volume;
});
console.log("volume = " + vol);
cdp.close();
