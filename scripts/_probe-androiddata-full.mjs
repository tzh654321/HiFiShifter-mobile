import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const inv = (c, a) => cdp.call((cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e).slice(0, 130) })), c, a);
console.log("bind = " + JSON.stringify(await inv("shizuku_bind_shell_service", {})));
let ready = null;
for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 400)); ready = await inv("shizuku_shell_ready", {}); if (ready && ready.ready) break; }
console.log("ready = " + JSON.stringify(ready));
const ls = await inv("list_directory", { dirPath: "/sdcard/Android/data" });
console.log("① list Android/data ⇒ " + (Array.isArray(ls) ? ls.length + " 项" : JSON.stringify(ls).slice(0,120)));
const f = await inv("shizuku_shell_exec", { command: "find /sdcard/Android/data -type f -name '*.mp3' -o -type f -name '*.m4a' 2>/dev/null | head -1" });
const target = String(f.output || "").split("\n").map(s=>s.trim()).filter((s) => s.startsWith("/"))[0];
console.log("② 目标音频 = " + target);
if (target) {
  const info = await inv("get_audio_file_info", { filePath: target });
  console.log("③ 直接取音频信息（自动走 shell 物化）⇒ " + JSON.stringify(info).slice(0, 170));
  const pv = await inv("read_audio_preview", { filePath: target, maxFrames: 2000 });
  console.log("④ 试听数据 ⇒ " + (pv && pv.pcmBase64 ? "PCM " + pv.sampleRate + "Hz/" + pv.channels + "ch ✓" : JSON.stringify(pv).slice(0,140)));
}
cdp.close();
