import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
// 确保文件浏览器打开（面板没开时里面什么都没有）
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (document.querySelector('[data-hs-split-handle="files"]')) return 'already';
  const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
  trig && trig.click();
  await wait(900);
  const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
    (x) => ((x.getAttribute('aria-label') || '').trim() === '文件浏览器' || (x.textContent || '').trim() === '文件浏览器') && x.children.length <= 3,
  );
  it && it.click();
  await wait(2600);
  return 'opened';
});
const out = await cdp.call(async () => {
  const inv = (cmd, a) => window.__TAURI_INTERNALS__.invoke(cmd, a).catch((e) => ({ err: String(e).slice(0, 110) }));
  // 只在**文件面板内部**找路径（面板外还有很多 data-tooltip，第一次就选错了）
  const h = document.querySelector('[data-hs-split-handle="files"]');
  let root = h;
  for (let i = 0; i < 8 && root && root.parentElement; i++) { root = root.parentElement; if (root.getBoundingClientRect().height > 150) break; }
  const pathEl = root ? [...root.querySelectorAll('[data-tooltip]')].find((e) => /\/|emulated|sdcard/.test(e.getAttribute('data-tooltip') || '')) : null;
  const dir = pathEl ? pathEl.getAttribute('data-tooltip') : '';
  const state = await inv('storage_access_state', { dirPath: dir });
  const list = await inv('list_directory', { dirPath: dir });
  const entries = Array.isArray(list) ? list : [];
  const audio = entries.find((e) => !e.isDir && /\.(wav|mp3|flac|m4a|ogg)$/i.test(e.name || ''));
  const fp = audio ? audio.path : null;
  const r = { dir, state, entryCount: entries.length, first: entries.slice(0, 3).map((e) => e.name), probed: fp };
  if (fp) {
    r.info = await inv('get_audio_file_info', { filePath: fp });
    r.preview = await inv('read_audio_preview', { filePath: fp, maxFrames: 2000 });
    r.streams = await inv('list_media_audio_streams', { filePath: fp });
    r.absForm = await inv('get_audio_file_info', { filePath: fp.startsWith('/') ? fp : '/' + fp });
  }
  return r;
});
console.log(JSON.stringify(out, null, 1).slice(0, 2400));
cdp.close();
