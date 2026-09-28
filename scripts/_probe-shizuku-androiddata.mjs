import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const inv = (c, a) => cdp.call((cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e).slice(0, 120) })), c, a);
// ① 应用内 list_directory 是否自动走 shell（Android/data）
const ls = await inv("list_directory", { dirPath: "/sdcard/Android/data" });
console.log("① list_directory(/sdcard/Android/data) ⇒ " + (Array.isArray(ls) ? `${ls.length} 项，例：${ls.slice(0,3).map(e=>e.name).join(', ')}` : JSON.stringify(ls).slice(0,160)));
// ② 在别的应用 data 里找一个音频文件
const f = await inv("shizuku_shell_exec", { command: "find /sdcard/Android/data -type f \\( -name '*.mp3' -o -name '*.wav' -o -name '*.m4a' -o -name '*.ogg' \\) 2>/dev/null | head -3" });
const found = String(f.output || "").split("\n").map(s=>s.trim()).filter(Boolean);
console.log("② 别的应用 data 里的音频：" + JSON.stringify(found));
if (found.length) {
  const copy = await inv("shizuku_shell_copy_to_cache", { path: found[0] });
  console.log("③ 经 shell 物化 ⇒ " + JSON.stringify(copy).slice(0, 160));
  const info = await inv("get_audio_file_info", { filePath: found[0] });
  console.log("④ 直接按原路径取音频信息（自动走 shell 物化）⇒ " + JSON.stringify(info).slice(0, 160));
}
cdp.close();
