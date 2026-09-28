import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const dump = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = document.querySelector('[data-hs-split-handle="files"]');
  if (!h) return { error: 'panel-not-open' };
  let root = h;
  for (let i = 0; i < 8 && root.parentElement; i++) { root = root.parentElement; if (root.getBoundingClientRect().height > 150) break; }
  const pathText = [...root.querySelectorAll('*')].map((e) => (e.textContent||'').trim()).filter((x) => x.startsWith('/') || x.includes('emulated'));
  const hint = document.querySelector('[data-hs-needs-auth="1"]');
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ __err: String(e) }));
  const guessPaths = ['/storage/emulated/0/HiFiShifter', '/storage/emulated/0', '/storage/emulated/0/Download'];
  const states = {};
  for (const p of guessPaths) states[p] = (await inv('storage_access_state', { dirPath: p })).needsAuth;
  return {
    hintPresent: Boolean(hint),
    pathCandidates: [...new Set(pathText)].slice(0, 6),
    panelTextHead: (root.innerText||'').replace(/\s+/g,' ').slice(0, 180),
    needsAuthByPath: states,
  };
});
console.log(JSON.stringify(dump, null, 1));
cdp.close();
