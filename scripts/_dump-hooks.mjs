#!/usr/bin/env node
/** 临时：查页面上可用的调试钩子（__hsStore 等）。 */
import { execSync } from "node:child_process";
import { Cdp } from "../scripts/lib/cdp.mjs";

const serial = process.argv[2] ?? "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(() => {
    const keys = Object.keys(window).filter((k) => k.startsWith("__hs"));
    const store = window.__hsStore;
    const clip = store ? store.getState().session.clips[0] : null;
    return {
        keys,
        hasStore: Boolean(store),
        clip: clip
            ? {
                  id: clip.id,
                  startSec: clip.startSec,
                  lengthSec: clip.lengthSec,
                  fadeInSec: clip.fadeInSec,
                  fadeOutSec: clip.fadeOutSec,
                  clipPlaybackRate: clip.clipPlaybackRate,
              }
            : null,
        pxPerSec: store ? store.getState().session.pxPerSec : null,
    };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
