import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ __err: String(e) }));
  const dir = document.querySelector('[data-tooltip*="emulated"]')?.getAttribute('data-tooltip') || 'storage/emulated/0/HiFiShifter';
  await wait(300);
  const st = await inv('storage_access_state', { dirPath: dir });
  const list = await inv('list_directory', { dirPath: dir });
  const hint = document.querySelector('[data-hs-needs-auth="1"]');
  return {
    dir,
    state: st,
    listed: Array.isArray(list) ? list.map((x) => x.name) : list,
    hintPresent: Boolean(hint),
  };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
