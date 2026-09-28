import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = document.querySelector('[data-hs-time-ruler="params"]');
  const c = document.querySelector('[data-hs-mobile-split]');
  const r = el ? el.getBoundingClientRect() : null;
  const seen = [];
  const cap = (e) => seen.push({ type: e.type, pt: e.pointerType, id: e.pointerId, target: e.target && e.target.tagName, closestBtn: e.target && e.target.closest ? Boolean(e.target.closest('button')) : null, closestHandle: e.target && e.target.closest ? Boolean(e.target.closest('[data-hs-split-handle], [data-hs-time-ruler="params"]')) : null });
  document.addEventListener('pointerdown', cap, true);
  const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 41, isPrimary: true, button: 0, buttons: 1, clientX: Math.round(r.left + 30), clientY: Math.round(r.top + r.height / 2) });
  el.dispatchEvent(ev);
  await wait(200);
  document.removeEventListener('pointerdown', cap, true);
  return {
    rulerRect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
    splitRect: c ? (() => { const rr = c.getBoundingClientRect(); return [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)]; })() : null,
    containsRuler: c && el ? c.contains(el) : null,
    seen,
  };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
