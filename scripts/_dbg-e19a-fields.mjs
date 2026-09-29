#!/usr/bin/env node
/** E19a 诊断：打印 get_param_frames 的真实返回（orig/edit 长度、后端 pitch 编辑可用性等）。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const audit = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 140) }));
        const st = await inv('get_timeline_state', {});
        const track = (st?.tracks || [])[0] ?? null;
        const trackId = track?.id ?? 'track_main';
        const nz = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0).length : -1);
        const values = Array.from({ length: 800 }, (_, i) => Math.sin(i / 20) * 200);
        const w = await inv('set_param_frames', { trackId, param: 'pitch', startFrame: 0, values, checkpoint: false });
        const r = await inv('get_param_frames', { trackId, param: 'pitch', startFrame: 0, frameCount: 800, stride: 1, binary: false });
        const keys = r && !r.err ? Object.keys(r) : [];
        return {
            trackId,
            trackKeys: track ? Object.keys(track).slice(0, 24) : null,
            trackAlgo: track?.pitch_analysis_algo ?? track?.algo ?? null,
            write: w,
            keys,
            origLen: Array.isArray(r?.orig) ? r.orig.length : null,
            origNonZero: nz(r?.orig),
            editLen: Array.isArray(r?.edit) ? r.edit.length : null,
            editNonZero: nz(r?.edit),
            backendAvailable: r?.pitch_edit_backend_available ?? null,
            userModified: r?.pitch_edit_user_modified ?? null,
            refKind: r?.reference_kind ?? null,
            framePeriodMs: r?.frame_period_ms ?? null,
            origHead: Array.isArray(r?.orig) ? r.orig.slice(0, 5) : null,
            editHead: Array.isArray(r?.edit) ? r.edit.slice(0, 5) : null,
            err: r?.err ?? null,
        };
    });
    console.log(JSON.stringify(audit, null, 1));
    cdp.close();
};

await main();
