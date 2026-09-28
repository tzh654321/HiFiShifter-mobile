#!/usr/bin/env node
/** 临时：测「单指横向拖动能否平移时间线视野」，并给出 scrollLeft 的真实可达域。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] || '221deeb';
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}
const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
    });
const read = () =>
    cdp.call(() => {
        const v = window.__hsViewport();
        const c = v.containerRect;
        return {
            scrollLeft: Math.round(v.scrollLeft),
            scrollTop: Math.round(v.scrollTop),
            pxPerSec: Math.round(v.pxPerSec),
            left: Math.round(c.left),
            width: Math.round(c.width),
            top: Math.round(c.top),
            height: Math.round(c.height),
        };
    });

const before = await read();
console.log('起始：' + JSON.stringify(before));

async function drag(yStart, fromX, toX, steps = 8) {
    await touch('touchStart', [{ id: 0, x: fromX, y: yStart }]);
    await sleep(50);
    for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ id: 0, x: Math.round(fromX + ((toX - fromX) * i) / steps), y: yStart }]);
        await sleep(30);
    }
    await touch('touchEnd', []);
    await sleep(400);
    return read();
}

/* 只按 y 区分，x 都从时间线区内部起手（左缘 +30），避开轨道头列。 */
const yInRow = before.top + 40; /* 轨道行内 */
const yBlank = before.top + before.height - 120; /* 行下方空白 */
const xa = before.left + 30;
const xb = before.left + before.width - 10;

console.log('① 行内 y=' + yInRow + '，右拖 ' + xa + '→' + xb + '：' + JSON.stringify(await drag(yInRow, xa, xb)));
console.log('② 空白 y=' + yBlank + '，右拖 ' + xa + '→' + xb + '：' + JSON.stringify(await drag(yBlank, xa, xb)));
console.log('③ 行内 y=' + yInRow + '，左拖 ' + xb + '→' + xa + '：' + JSON.stringify(await drag(yInRow, xb, xa)));
console.log('④ 空白 y=' + yBlank + '，左拖 ' + xb + '→' + xa + '：' + JSON.stringify(await drag(yBlank, xb, xa)));
cdp.close();
