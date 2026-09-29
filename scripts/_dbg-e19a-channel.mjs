import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const r = await cdp.call(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 130) }));
  // 后端造块（不需要前端 store —— 参数读写都是后端接口）
  const imp = await inv("import_audio_item", { audioPath: "/sdcard/Download/test-rr.wav", trackId: null, startSec: 0, mediaAudioStreamIndex: null });
  await new Promise((x) => setTimeout(x, 3000));
  const st = await inv("get_timeline_state", {});
  const clips = (st?.clips || []).length;
  const trackId = (st?.tracks || [])[0]?.id ?? "track_main";
  const values = Array.from({ length: 1200 }, (_, i) => Math.sin(i / 30) * 250);
  const w = await inv("set_param_frames", { trackId, param: "pitch", startFrame: 0, values, checkpoint: false });
  await new Promise((x) => setTimeout(x, 1200));
  const g = await inv("get_param_frames", { trackId, param: "pitch", startFrame: 0, frameCount: 1200, stride: 1 });
  const arr = g?.edit ?? g?.orig ?? [];
  return {
    importResult: imp && imp.ok !== undefined ? { ok: imp.ok } : imp,
    clips,
    trackId,
    write: w,
    readLen: arr.length,
    nonZero: arr.filter((v) => typeof v === "number" && v !== 0).length,
    origLen: Array.isArray(g?.orig) ? g.orig.length : null,
    editLen: Array.isArray(g?.edit) ? g.edit.length : null,
    backend: g?.pitch_edit_backend_available ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
cdp.close();
