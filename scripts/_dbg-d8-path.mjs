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
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const clips = async () => (await inv("get_timeline_state", {})).clips.length;
  const tl = document.querySelector('[data-hs-surface="timeline"]');
  const row = document.querySelector('[data-hs-track-row]');
  const tr = tl.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const x = Math.round(tr.left + tr.width * 0.5), y = Math.round(rr.top + rr.height * 0.6);
  const fire = (path) => window.dispatchEvent(new CustomEvent("hifi-file-drag", { detail: { type: "drop", filePath: path, fileName: path.split("/").pop(), filePaths: [path], clientX: x, clientY: y, isRightDrag: false } }));
  const base = await clips();
  // A) 缺前导斜杠（文件浏览器当前给的就是这种）
  fire("storage/emulated/0/HiFiShifter/hs-tone.wav");
  await wait(2500); const afterA = await clips();
  // B) 绝对路径
  fire("/storage/emulated/0/HiFiShifter/hs-tone.wav");
  await wait(3000); const afterB = await clips();
  let err = null;
  try { await inv("get_audio_file_info", { filePath: "/storage/emulated/0/HiFiShifter/hs-tone.wav" }); } catch (e) { err = String(e).slice(0, 120); }
  return { at: [x, y], base, afterA, afterB, infoErr: err };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
