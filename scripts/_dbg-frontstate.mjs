import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const el = await cdp.call(() => {
  const host = document.querySelector('[data-hs-surface="timeline"]');
  const kernel = document.querySelector('[data-hs-timeline-kernel="1"]');
  const canvases = [...document.querySelectorAll("canvas")].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  return { host: !!host, kernel: !!kernel, canvases, dotCount: document.querySelectorAll('[data-hs-clip-control-point]').length };
});
console.log("DOM：" + JSON.stringify(el));
cdp.close();
