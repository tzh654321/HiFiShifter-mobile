import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
adb("logcat -c");
const info = await cdp.call(() => {
  const ae = document.activeElement;
  const editable = [...document.querySelectorAll('input, textarea, [contenteditable]')].map((e) => ({
    tag: e.tagName, type: e.type || null, focused: e === ae, ce: e.getAttribute('contenteditable'),
  }));
  return {
    activeTag: ae ? ae.tagName : null,
    activeCls: ae ? String(ae.className || '').slice(0, 40) : null,
    editableCount: editable.length,
    focusedEditable: editable.filter((e) => e.focused).length,
    selection: String(document.getSelection()?.toString?.() || '').slice(0, 20),
  };
});
console.log("页面可编辑上下文：" + JSON.stringify(info));
// 静置 12 秒，看剪贴板是否**在没有交互时**仍被访问
await new Promise((r) => setTimeout(r, 12000));
const log = adb("logcat -d -t 400").split("\n").filter((l) => /ClipboardService/.test(l));
console.log("静置 12s 内剪贴板访问次数 = " + log.length);
log.slice(-4).forEach((l) => console.log("   " + l.trim().slice(0, 140)));
cdp.close();
