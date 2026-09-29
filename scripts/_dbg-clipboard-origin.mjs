import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
// 注入 hook：记录任何 JS 侧剪贴板访问
await cdp.call(() => {
  window.__hsClipCalls = [];
  const rec = (n) => { try { window.__hsClipCalls.push({ n, t: Date.now() }); } catch {} };
  if (navigator.clipboard) {
    const origRead = navigator.clipboard.readText?.bind(navigator.clipboard);
    const origWrite = navigator.clipboard.writeText?.bind(navigator.clipboard);
    if (origRead) navigator.clipboard.readText = async (...a) => { rec("readText"); return origRead(...a); };
    if (origWrite) navigator.clipboard.writeText = async (...a) => { rec("writeText"); return origWrite(...a); };
  }
  const origExec = document.execCommand?.bind(document);
  if (origExec) document.execCommand = (...a) => { if (String(a[0]).includes("copy") || String(a[0]).includes("paste")) rec("execCommand:" + a[0]); return origExec(...a); };
  return true;
});
adb("logcat -c");
console.log("已 hook；静置 14 秒观察…");
await new Promise((r) => setTimeout(r, 14000));
const calls = await cdp.call(() => window.__hsClipCalls || []);
const log = adb("logcat -d -t 600").split("\n").filter((l) => /ClipboardService/.test(l));
console.log("JS 侧剪贴板调用 = " + JSON.stringify(calls));
console.log("native 侧 ClipboardService 访问次数 = " + log.length + "（14 秒内）");
log.slice(0, 3).forEach((l) => console.log("   " + l.trim().slice(0, 130)));
cdp.close();
