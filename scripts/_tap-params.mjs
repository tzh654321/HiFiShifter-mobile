import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const btn = await cdp.call(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '参数');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: +(r.left + r.width / 2).toFixed(0), y: +(r.top + r.height / 2).toFixed(0) };
});
console.log('参数页签:', JSON.stringify(btn));
if (!btn) { cdp.close(); process.exit(2); }

await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: btn.x, y: btn.y, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(1500);

const after = await cdp.call(() => {
    const tabs = [...document.querySelectorAll('nav[aria-label="主面板切换"] button')].map((b) => ({
        t: (b.textContent || '').trim(),
        cur: b.getAttribute('aria-current'),
    }));
    const toolbar = [...document.querySelectorAll('[role="toolbar"][aria-label="编辑开关"] button')].map((b) => ({
        t: (b.textContent || '').trim(),
        pressed: b.getAttribute('aria-pressed'),
    }));
    const pianoRollVisible = (() => {
        const els = [...document.querySelectorAll('*')].filter((e) => e.style && e.style.touchAction === 'none');
        return els.map((e) => {
            const r = e.getBoundingClientRect();
            return { w: +r.width.toFixed(0), h: +r.height.toFixed(0) };
        });
    })();
    return { tabs, toolbar, gestureHost: pianoRollVisible };
});
console.log('切换后:', JSON.stringify(after, null, 1));
cdp.close();
execSync('D:/Android/Sdk/platform-tools/adb.exe -s 221deeb shell screencap -p /sdcard/hs-phone.png');
execSync('D:/Android/Sdk/platform-tools/adb.exe -s 221deeb pull /sdcard/hs-phone.png .setup/phone-shell-04-params.png');
console.log('截图完成');
