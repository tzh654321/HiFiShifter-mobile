import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(() => {
  const btns = [...document.querySelectorAll('button')].map((b, i) => {
    const r = b.getBoundingClientRect();
    return {
      i,
      text: (b.textContent || '').trim().slice(0, 12),
      tip: (b.getAttribute('data-tooltip') || b.ariaLabel || '').trim().slice(0, 14),
      cls: String(b.className || '').slice(0, 26),
      at: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
  }).filter((b) => b.at[2] > 0 && b.at[3] > 0);
  return btns.slice(0, 42);
});
console.log(JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
cdp.close();
