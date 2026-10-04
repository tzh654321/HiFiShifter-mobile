#!/usr/bin/env node
/**
 * 扫 `sendevent` 协议变体：哪种能让 WebView 收到 pointerdown。
 * （设备已 root；`input tap` 作为对照组。）
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERIAL = '221deeb';
const D = '/dev/input/event6';
const X = 10112, Y = 16848; // css(180,300)

async function page() {
    const pid = execSync(`adb -s ${SERIAL} shell pidof com.arounder.hifisher 2>/dev/null || adb -s ${SERIAL} shell pidof com.arounder.hifishifter`)
        .toString().trim();
    execSync(`adb -s ${SERIAL} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    return cdp;
}
const adb = (c) => execSync(`adb -s ${SERIAL} ${c}`, { stdio: 'pipe' }).toString();

const variants = {
    A: ['3 47 0', '3 57 300', `3 53 ${X}`, `3 54 ${Y}`, '0 0 0'],
    B: ['3 47 0', '3 57 300', `3 53 ${X}`, `3 54 ${Y}`, '1 330 1', '0 0 0'],
    C: ['1 325 1', '3 47 0', '3 57 300', `3 53 ${X}`, `3 54 ${Y}`, '1 330 1', '0 0 0'],
    D: ['1 325 1', '3 47 0', '3 57 300', '3 55 0', `3 53 ${X}`, `3 54 ${Y}`, '3 48 20', '3 58 40', '1 330 1', '0 0 0'],
    E: ['1 325 1', `3 53 ${X}`, `3 54 ${Y}`, '3 48 20', `3 24 40`, '1 330 1', '0 0 0'],
    F: ['1 330 1', '3 47 0', '3 57 300', `3 53 ${X}`, `3 54 ${Y}`, '0 0 0'],
};
const UP = ['3 47 0', '3 57 -1', '1 330 0', '1 325 0', '0 0 0'];

const cdp = await page();
const len = () => cdp.call(() => (window.__hsTrace || []).length);
const reset = () => cdp.call(() => { window.__hsTrace.length = 0; return true; });

console.log('recorder =', await cdp.call(() => window.__hsRecV || null));

for (const [k, evs] of Object.entries(variants)) {
    await reset();
    const body = ['#!/system/bin/sh', `D=${D}`, ...evs.map((e) => `sendevent $D ${e}`), 'sleep 0.20', ...UP.map((e) => `sendevent $D ${e}`)].join('\n') + '\n';
    writeFileSync(`D:\\Temp\\var-${k}.sh`, body);
    adb(`push D:/Temp/var-${k}.sh /data/local/tmp/var-${k}.sh`);
    try {
        adb(`shell su -c "sh /data/local/tmp/var-${k}.sh"`);
    } catch (e) {
        console.log(`变体 ${k}: 注入报错 ${String(e.message).slice(0, 60)}`);
    }
    await sleep(900);
    console.log(`变体 ${k}: 页面事件 ${await len()} 条`);
}

/* 对照组：input tap（走 InputManager，不经设备节点） */
await reset();
adb('shell input tap 540 900');
await sleep(900);
console.log(`对照 input tap: 页面事件 ${await len()} 条`);

cdp.close();
process.exit(0);
