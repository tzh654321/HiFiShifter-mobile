#!/usr/bin/env node
/**
 * 诊断小工具：把轨道行的**层级缩进**读出来（E33-6/7 到底是"跨层级没落点"还是"阈值差一点"）。
 * 缩进来自 `TrackList` 的行内 `paddingLeft = depth * 16` ⇒ 取每行里色点（`[data-track-color-picker]`）
 * 的 left 就能反推层级。
 *
 * 用法：node scripts/_dbg-track-levels.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!pid) {
    console.error('🔴 app 未运行');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const out = await cdp.call(() => {
    const rows = [...document.querySelectorAll('[data-hs-track-row]')];
    return rows.map((r) => {
        const rect = r.getBoundingClientRect();
        const picker = r.querySelector('[data-track-color-picker]');
        const pr = picker ? picker.getBoundingClientRect() : null;
        return {
            id: (r.getAttribute('data-hs-track-row') || '').slice(0, 14),
            top: +rect.top.toFixed(1),
            h: +rect.height.toFixed(1),
            pickerLeft: pr ? +pr.left.toFixed(1) : null,
            indentPx: pr ? Math.round(pr.left - rect.left) : null,
        };
    });
});
console.log(JSON.stringify(out, null, 1));
const selected = await cdp.call(() => {
    try {
        const s = window.__hsSelection ? window.__hsSelection() : null;
        return s ? s.trackId : null;
    } catch {
        return null;
    }
});
console.log('selectedTrackId =', selected);
cdp.close();
