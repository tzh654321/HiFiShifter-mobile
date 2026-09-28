import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = argvSerial();
function argvSerial(){ const i = process.argv.indexOf("--serial"); return i > 0 ? process.argv[i+1] : "emulator-5554"; }
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const info = await cdp.call(() => {
  const q = (s) => [...document.querySelectorAll(s)].map((e) => {
    const r = e.getBoundingClientRect();
    return { tag: e.tagName, attr: e.getAttribute('data-hs-split-handle') || e.getAttribute('data-hs-time-ruler') || '', cls: (e.className||'').toString().slice(0,26), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  });
  const surface = (s) => Boolean(document.querySelector(s));
  // 分屏容器：找 mobileSplit 的两子块
  const surfaces = { timeline: surface('[data-hs-surface="timeline"]'), pianoRoll: surface('[data-hs-surface="pianoRoll"]') };
  const bodyAttrs = [...document.body.attributes].map((a) => a.name + '=' + a.value.slice(0,20)).filter((x) => x.startsWith('data-hs'));
  return { handles: q('[data-hs-split-handle]'), paramsRuler: q('[data-hs-time-ruler="params"]'), surfaces, bodyAttrs, hasSplitRef: Boolean(document.querySelector('[data-hs-mobile-split]')) };
});
console.log(JSON.stringify(info, null, 1));
cdp.close();
