import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).then((x) => x).catch((e) => ({ err: String(e).slice(0, 90) }));
  return {
    自有目录: await inv("get_audio_file_info", { filePath: "/storage/emulated/0/Android/data/com.arounder.hifishifter/files/priv-tone.wav" }),
    授权目录: await inv("get_audio_file_info", { filePath: "/storage/emulated/0/HiFiShifter/hs-tone.wav" }),
    授权目录_无斜杠: await inv("get_audio_file_info", { filePath: "storage/emulated/0/HiFiShifter/hs-tone.wav" }),
  };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
