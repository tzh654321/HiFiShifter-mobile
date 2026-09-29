import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const r = await cdp.call(() => {
  const box = document.querySelector('[data-hs-mobile-split="1"]');
  const bar = document.querySelector('[data-hs-split-handle="param-toolbar"]');
  const files = document.querySelector('[data-hs-split-handle="files"]');
  const chain = (el) => { const a = []; let p = el; while (p && a.length < 8) { a.push(p.tagName + (p.getAttribute && p.getAttribute("data-hs-mobile-split") ? '[SPLIT]' : '')); p = p.parentElement; } return a.join(' < '); };
  return {
    hasSplit: Boolean(box),
    hasBar: Boolean(bar),
    barInsideSplit: box && bar ? box.contains(bar) : null,
    filesInsideSplit: box && files ? box.contains(files) : null,
    barChain: bar ? chain(bar) : null,
    boxChildren: box ? [...box.children].map((c) => Math.round(c.getBoundingClientRect().height)) : null,
  };
});
console.log(JSON.stringify(r, null, 1));
cdp.close();
