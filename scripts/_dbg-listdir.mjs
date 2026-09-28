import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const r = await cdp.call(async () => {
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).then((x) => x).catch((e) => ({ __err: String(e) }));
  const out = {};
  out.list = await inv("list_directory", { dirPath: "/storage/emulated/0/HiFiShifter" });
  out.tree = await inv("get_saved_tree_uri").catch(() => "no-cmd");
  out.roots = await inv("list_directory", { dirPath: "/storage/emulated/0" });
  out.home = await inv("list_directory", { dirPath: "/storage/emulated/0/Download" });
  return out;
});
const brief = (v) => {
  if (Array.isArray(v)) return "数组 " + v.length + " 项: " + JSON.stringify(v.slice(0,3));
  return JSON.stringify(v).slice(0, 400);
};
for (const k of Object.keys(r)) console.log("• " + k + ": " + brief(r[k]));
cdp.close();
