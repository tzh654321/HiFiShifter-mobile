import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ __err: String(e) }));
  const tip = [...document.querySelectorAll('[data-tooltip]')].map((e) => e.getAttribute('data-tooltip')).filter((x) => x && x.includes('emulated'));
  const withSlash = await inv('storage_access_state', { dirPath: '/storage/emulated/0/HiFiShifter' });
  const noSlash = await inv('storage_access_state', { dirPath: 'storage/emulated/0/HiFiShifter' });
  const listWith = await inv('list_directory', { dirPath: '/storage/emulated/0/HiFiShifter' });
  const listNo = await inv('list_directory', { dirPath: 'storage/emulated/0/HiFiShifter' });
  return {
    tooltips: [...new Set(tip)].slice(0, 4),
    stateWithSlash: withSlash, stateNoSlash: noSlash,
    listWithSlash: Array.isArray(listWith) ? listWith.map((x) => x.name) : listWith,
    listNoSlash: Array.isArray(listNo) ? listNo.map((x) => x.name) : listNo,
  };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
