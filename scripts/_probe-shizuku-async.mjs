import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
// 打开文件浏览器
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (document.querySelector('[data-hs-split-handle="files"]')) return;
  const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
  trig && trig.click(); await wait(900);
  const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === '文件浏览器' || (x.textContent||'').trim() === '文件浏览器') && x.children.length <= 3);
  it && it.click(); await wait(2600);
});
const st = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("shizuku_state").catch((e) => ({ err: String(e) })));
console.log("shizuku_state = " + JSON.stringify(st));
const before = await cdp.call(() => ({ playing: null, allFiles: null }));
const init = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("storage_access_state", { dirPath: "/sdcard/Download" }).catch((e) => ({ err: String(e) })));
console.log("before: storage_access_state(/sdcard/Download) = " + JSON.stringify(init));
const r = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("grant_all_files_via_shizuku").catch((e) => ({ err: String(e) })));
console.log("发起授权 = " + JSON.stringify(r));
let result = null;
for (let i = 0; i < 20; i++) {
  await new Promise((res) => setTimeout(res, 500));
  result = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("shizuku_grant_result").catch((e) => ({ err: String(e) })));
  if (result && !result.pending) break;
}
console.log("轮询结果 = " + JSON.stringify(result));
const after = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("storage_access_state", { dirPath: "/sdcard/Download" }).catch((e) => ({ err: String(e) })));
console.log("after:  storage_access_state(/sdcard/Download) = " + JSON.stringify(after));
const alive = adb("shell pidof com.arounder.hifishifter").trim();
console.log("进程 = " + (alive ? "存活 pid=" + alive : "❌ 已死（仍闪退）"));
cdp.close();
