import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const inv = (c, a) => cdp.call((cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e).slice(0, 120) })), c, a);
console.log("shizuku_state = " + JSON.stringify(await inv("shizuku_state", {})));
console.log("绑定 = " + JSON.stringify(await inv("shizuku_bind_shell_service", {})));
let ready = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ready = await inv("shizuku_shell_ready", {});
  if (ready && ready.ready) break;
}
console.log("shell 就绪 = " + JSON.stringify(ready));
const id = await inv("shizuku_shell_exec", { command: "id" });
console.log("id = " + JSON.stringify(String(id.output || id.err).slice(0, 120)));
const ls = await inv("shizuku_shell_list_dir", { path: "/sdcard/Android/data" });
const json = String(ls.json || "");
console.log("列 /sdcard/Android/data = " + (json.startsWith("[" ) ? json.slice(0, 320) : JSON.stringify(ls).slice(0, 220)));
cdp.close();
