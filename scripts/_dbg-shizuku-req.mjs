import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const r = await cdp.call(() => window.__TAURI_INTERNALS__.invoke("request_shizuku_permission").catch((e) => ({ err: String(e) })));
console.log("request_shizuku_permission → " + JSON.stringify(r));
for (let i = 0; i < 8; i++) {
  await new Promise((r2) => setTimeout(r2, 900));
  const w = adb("shell dumpsys window");
  const f = (w.match(/mCurrentFocus=\S+ \S+ ([^\s}]+)/) || [])[1] || "?";
  console.log(`  t+${(i + 1) * 0.9}s 前台=${f}`);
}
console.log("---- 应用日志 ----");
console.log(adb("logcat -d -t 200").split("\n").filter((l) => /HS-SAF|Shizuku|rikka/i.test(l)).slice(-10).join("\n") || "(无)");
cdp.close();
