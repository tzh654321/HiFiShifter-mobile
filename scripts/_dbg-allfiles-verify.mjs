import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 100) }));
  const paths = ["/storage/emulated/0/Download", "/sdcard/Download"];
  const states = {};
  for (const p of paths) states[p] = await inv("storage_access_state", { dirPath: p });
  // 全盘真路径直读（不物化、不走 SAF）
  const read = await inv("get_audio_file_info", { filePath: "/sdcard/Download/test-rr.wav" });
  const list = await inv("list_directory", { dirPath: "/sdcard/Download" });
  return {
    states,
    directRead: read,
    listedCount: Array.isArray(list) ? list.length : list,
    listedAudio: Array.isArray(list) ? list.filter((e) => /\.(wav|mp3|flac)$/i.test(e.name || "")).slice(0, 4).map((e) => e.name) : [],
  };
});
console.log(JSON.stringify(out, null, 1).slice(0, 1800));
cdp.close();
