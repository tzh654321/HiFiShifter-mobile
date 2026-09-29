import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const r = await cdp.call(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 120) }));
  const before = (await inv("get_timeline_state", {}))?.tracks?.[0]?.volume;
  // 直接调后端命令（与 thunk 走同一个）
  const res = await inv("set_track_state", { trackId: "track_main", volume: 0.5 });
  const after = (await inv("get_timeline_state", {}))?.tracks?.[0]?.volume;
  return { before, res: res && res.err ? res : "ok", after };
});
console.log("直接调 set_track_state：" + JSON.stringify(r));
cdp.close();
