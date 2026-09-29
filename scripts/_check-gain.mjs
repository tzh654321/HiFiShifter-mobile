import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const v = await cdp.call(async () => {
  const st = await window.__TAURI_INTERNALS__.invoke("get_timeline_state", {}).catch(() => null);
  const t = (st?.tracks || [])[0];
  const el = document.querySelector("[data-track-gain-value]");
  return { volume: t?.volume ?? null, label: el ? (el.textContent || "").trim() : null };
});
console.log("后端/UI 增益：" + JSON.stringify(v));
cdp.close();
