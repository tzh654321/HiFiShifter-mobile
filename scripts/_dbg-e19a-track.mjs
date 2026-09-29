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
  const st = await inv("get_timeline_state", {});
  const tracks = (st?.tracks || []).map((t) => ({ id: t.id, root: t.root_track_id ?? null, group: t.group_id ?? null, name: t.name ?? null }));
  const first = await inv("get_param_frames", { trackId: "track_main", param: "pitch", startFrame: 0, frameCount: 100, stride: 1 });
  return { tracks, rootTrackIdInResp: first?.root_track_id ?? null, startFrame: first?.start_frame ?? null, ok: first?.ok ?? null, origLen: Array.isArray(first?.orig) ? first.orig.length : null };
});
console.log(JSON.stringify(r, null, 1));
cdp.close();
