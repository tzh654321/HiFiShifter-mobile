#!/usr/bin/env node
/** 一次性诊断：揪出 (x=135, y=99..135) 上那个 fixed 覆盖层到底是什么。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    // 先在一个"干净"位置移动鼠标，再移到块顶带里，观察覆盖层是否随 hover 出现
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 600 });
    await sleep(300);
    const before = await cdp.call(() => {
        const el = document.elementFromPoint(135, 117);
        return { tag: el?.tagName, cls: String(el?.className).slice(0, 60), text: (el?.textContent || '').slice(0, 40) };
    });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 135, y: 117 });
    await sleep(400);
    const after = await cdp.call(() => {
        const el = document.elementFromPoint(135, 117);
        const r = el ? el.getBoundingClientRect() : null;
        const attrs = el ? [...el.attributes].map((a) => `${a.name}="${String(a.value).slice(0, 60)}"`) : [];
        const parent = el?.parentElement;
        return {
            tag: el?.tagName,
            cls: String(el?.className),
            attrs,
            rect: r ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : null,
            text: (el?.textContent || '').replace(/\s+/g, ' ').slice(0, 120),
            childCount: el?.children.length ?? -1,
            parentAttrs: parent ? [...parent.attributes].map((a) => `${a.name}="${String(a.value).slice(0, 60)}"`) : [],
            parentCls: String(parent?.className),
        };
    });
    console.log('▸ 鼠标在 (300,600) 时，(135,117) 上是：' + JSON.stringify(before));
    console.log('▸ 鼠标移到 (135,117) 后，(135,117) 上是：\n' + JSON.stringify(after, null, 1));
    cdp.close();
};

await main();
