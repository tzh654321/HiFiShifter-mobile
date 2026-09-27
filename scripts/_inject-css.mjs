#!/usr/bin/env node
/**
 * 把一段 CSS 注入 WebView（不动源码、不重新构建），用来**先验证布局改法**再落源码。
 *
 *   node scripts/_inject-css.mjs --file /tmp/patch.css
 *   node scripts/_inject-css.mjs --css ".a{color:red}" --measure ".hs-param-rows"
 *   node scripts/_inject-css.mjs --reset             # 清掉注入的 style
 *
 * 注入的 <style> 带 id="__probe_css"，多次注入会覆盖（不会堆积）。
 * 配合下面两个动作使用：
 *   --measure <sel>  注入后打印该选择器下所有元素的 rect（含溢出量 over = right - 视口宽）
 *   默认还会检查 `.hs-param-rows` 与 `.hs-param-toolbar` 里的溢出项
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, css: '', file: '', sel: '' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--css') o.css = argv[++i];
        else if (a === '--file') o.file = readFileSync(argv[++i], 'utf8');
        else if (a === '--measure') o.sel = argv[++i];
        else if (a === '--reset') o.css = '';
    }
    o.css = o.css || o.file;
    return o;
}

/** 注入 CSS 并返回注入后的测量结果（自包含，不能引用外部函数）。 */
function inPageApply(css, sel) {
    const id = '__probe_css';
    document.getElementById(id)?.remove();
    if (css) {
        const st = document.createElement('style');
        st.id = id;
        st.textContent = css;
        document.head.appendChild(st);
    }
    return true;
}

function inPageMeasure(sel) {
    const W = window.innerWidth;
    const out = { viewportW: W, items: [] };
    const root = sel ? document.querySelectorAll(sel) : [document.querySelector('.hs-param-rows') || document.body];
    for (const r of root) {
        if (!r) continue;
        const rr = r.getBoundingClientRect();
        out.items.push({
            c: String(r.className || '').slice(0, 28),
            x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height),
            over: rr.right > W ? Math.round(rr.right - W) : 0,
        });
    }
    // 溢出扫描：所有可见的后代元素（限浮层/指定选择器内）
    const scanRoot = sel ? document.querySelector(sel) : document.querySelector('.hs-param-rows');
    if (scanRoot) {
        for (const e of scanRoot.querySelectorAll('*')) {
            const r = e.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const over = r.right > W ? Math.round(r.right - W) : 0;
            const t = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14);
            if (over > 0 || r.left < 0) {
                out.items.push({
                    over, neg: r.left < 0 ? Math.round(-r.left) : 0,
                    c: String(e.className || '').slice(0, 26), t,
                    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                });
            }
        }
    }
    return out;
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    await cdp.call(inPageApply, o.css, o.sel);
    await sleep(320);
    const res = await cdp.call(inPageMeasure, o.sel);
    console.log(`▸ 视口宽 ${res.viewportW} CSS px，注入 ${o.css ? o.css.length + ' 字节' : '（已清除）'}`);
    for (const it of res.items) {
        const flag = it.over ? `🔴 溢出 ${it.over}` : it.neg ? `🔴 左溢出 ${it.neg}` : 'ok';
        console.log(`  ${flag.padEnd(14)} ${String(it.c).padEnd(28)} x=${String(it.x).padStart(5)} y=${String(it.y).padStart(5)} w=${String(it.w).padStart(4)} h=${String(it.h).padStart(4)}  ${it.t || ''}`);
    }
    cdp.close();
}

await main();
