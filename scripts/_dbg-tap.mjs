#!/usr/bin/env node
/**
 * 极简：在设备页面里按 CSS 坐标点一下（鼠标事件，避开触摸的 pointercancel）。
 *
 * 用法：node scripts/_dbg-tap.mjs <serial> <x> <y>
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const x = Number(process.argv[3] ?? 0);
const y = Number(process.argv[4] ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(700);
const r = await cdp.call(() => ({
    quickActions: document.querySelectorAll('[data-hs-clip-actions]').length,
    cpRoot: Boolean(document.querySelector('[data-hs-clip-control-points]')),
    dots: [...document.querySelectorAll('[data-hs-clip-control-point]')].map((el) => el.getAttribute('data-hs-clip-control-point')),
}));
console.log(`▸ 点了 (${x},${y}) ⇒ ` + JSON.stringify(r));
cdp.close();
