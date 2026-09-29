import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const d = await cdp.call(async () => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
  const vp = window.__hsViewport ? window.__hsViewport() : null;
  const st = await inv("get_timeline_state", {});
  const c = (st.clips || [])[0];
  const canvases = [...document.querySelectorAll("canvas")].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  const big = canvases.sort((a,b)=>b[2]*b[3]-a[2]*a[3])[0];
  const start = c ? (c.start_sec ?? 0) : null, dur = c ? (c.duration_sec ?? 0) : null;
  return {
    vp,
    clip: c ? { id: c.id, start, dur, trackId: c.track_id } : null,
    canvas: big,
    clipPx: c && vp && big ? {
      left: Math.round(big[0] + (start - (vp.scrollLeft ?? 0)) * vp.pxPerSec),
      width: Math.round(dur * vp.pxPerSec),
      rowTop: Math.round(big[1] + 0 * vp.rowHeight - (vp.scrollTop ?? 0)),
    } : null,
  };
});
console.log(JSON.stringify(d).slice(0, 600));
cdp.close();
