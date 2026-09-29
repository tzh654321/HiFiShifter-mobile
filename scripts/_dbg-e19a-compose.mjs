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
  const trackId = "track_main";
  const stateOf = async () => {
    const st = await inv("get_timeline_state", {});
    const t = (st?.tracks || []).find((x) => x.id === trackId) ?? (st?.tracks || [])[0];
    return { compose: t?.compose_enabled ?? null, algo: t?.pitch_analysis_algo ?? null, clips: (st?.clips || []).length };
  };
  const before = await stateOf();
  // ① 打开 compose
  const setRes = await inv("set_track_state", { trackId, composeEnabled: true });
  await new Promise((x) => setTimeout(x, 1500));
  const after = await stateOf();
  // ② 写基线并读回
  const values = Array.from({ length: 1200 }, (_, i) => Math.sin(i / 30) * 250);
  const w = await inv("set_param_frames", { trackId, param: "pitch", startFrame: 0, values, checkpoint: false });
  await new Promise((x) => setTimeout(x, 2500));
  const g = await inv("get_param_frames", { trackId, param: "pitch", startFrame: 0, frameCount: 1200, stride: 1 });
  const edit = Array.isArray(g?.edit) ? g.edit : [];
  const orig = Array.isArray(g?.orig) ? g.orig : [];
  return {
    before, setRes: setRes && setRes.ok !== undefined ? { ok: setRes.ok } : setRes, after,
    write: w,
    editLen: edit.length, editNonZero: edit.filter((v) => typeof v === "number" && v !== 0).length,
    origLen: orig.length, origNonZero: orig.filter((v) => typeof v === "number" && v !== 0).length,
    backend: g?.pitch_edit_backend_available ?? null,
  };
});
console.log(JSON.stringify(r, null, 1));
cdp.close();
