import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (document.querySelector('[data-hs-split-handle="files"]')) return;
  const t = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
  t && t.click(); await wait(900);
  const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === '文件浏览器' || (x.textContent||'').trim() === '文件浏览器') && x.children.length <= 3);
  it && it.click(); await wait(2600);
});
const r = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("grant_all_files_via_shizuku").catch((e) => ({ err: String(e) })));
console.log("发起 = " + JSON.stringify(r));
cdp.close();
