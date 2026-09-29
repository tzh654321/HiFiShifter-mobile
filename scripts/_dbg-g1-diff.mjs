import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 切轨道面板 + 确保有块
const prep = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
  window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
  await wait(1800);
  let st = await inv("get_timeline_state", {});
  if (!(st.clips || []).length) {
    await inv("import_audio_item", { audioPath: "/sdcard/Download/test-rr.wav", trackId: null, startSec: 0, mediaAudioStreamIndex: null });
    await wait(2600); st = await inv("get_timeline_state", {});
  }
  return { clips: (st.clips || []).length, id: (st.clips || [])[0]?.id ?? null };
});
console.log("准备：" + JSON.stringify(prep));
const snapshot = () => cdp.call(() => ({
  divCount: document.querySelectorAll("div").length,
  bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
}));
const before = await snapshot();
console.log("派发前：div=" + before.divCount);
await cdp.call((p) => window.dispatchEvent(new CustomEvent("hs-open-clip-context-menu", { detail: { x: 100, y: 300, clipId: p.id } })), prep);
await sleep(1800);
const after = await snapshot();
console.log("派发后：div=" + after.divCount);
console.log("文本前 200：" + before.bodyText.slice(0, 200));
console.log("文本后 400：" + after.bodyText.slice(0, 400));
console.log("div 数变化：" + (after.divCount - before.divCount));
cdp.close();
