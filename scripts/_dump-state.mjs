#!/usr/bin/env node
/** 临时：dump `get_timeline_state` 的字段名与 `__hsViewport()` 真值。 */
import { execSync } from "node:child_process";
import { Cdp } from "../scripts/lib/cdp.mjs";

const pid = execSync("adb -s emulator-5554 shell pidof com.arounder.hifishifter").toString().trim();
execSync(`adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(() =>
    window.__TAURI_INTERNALS__.invoke("get_timeline_state").then((s) => ({
        keys: Object.keys(s),
        clipCount: (s.clips || []).length,
        clip0keys: s.clips && s.clips[0] ? Object.keys(s.clips[0]) : null,
        clip0raw: s.clips && s.clips[0] ? JSON.stringify(s.clips[0]).slice(0, 1200) : null,
        track0: s.tracks && s.tracks[0] ? JSON.stringify(s.tracks[0]).slice(0, 400) : null,
        vp: window.__hsViewport ? window.__hsViewport() : null,
    })),
);
console.log(JSON.stringify(out, null, 1));
cdp.close();
