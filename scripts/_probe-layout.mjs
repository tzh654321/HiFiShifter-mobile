#!/usr/bin/env node
/**
 * 布局带探查：把某个 y 区间内的「块级可见元素」按位置列出来 —— 用来找**多余空行**、
 * 或者确认某一行到底被谁占着。比截图更硬：能直接读到 rect 与类名。
 *
 * 用法：
 *   node scripts/_probe-layout.mjs --serial 221deeb --from 0 --to 260
 *   node scripts/_probe-layout.mjs --serial 221deeb --from 0 --to 260 --all   # 连小子元素一起列
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, from: 0, to: 260, minW: 60, minH: 8, xmax: 0 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--from') o.from = Number(argv[++i]);
        else if (a === '--to') o.to = Number(argv[++i]);
        else if (a === '--all') { o.minW = 0; o.minH = 0; }
        else if (a === '--xmax') o.xmax = Number(argv[++i]);
        else if (a === '--xmax') o.xmax = Number(argv[++i]);
    }
    return o;
}

/** 自包含：列区间内的块级可见元素。 */
function inPageBands(from, to, minW, minH, xmax) {
    const out = [];
    for (const e of document.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.width < minW || r.height < minH) continue;
        if (xmax > 0 && r.left > xmax) continue;
        if (r.bottom <= from || r.top >= to) continue;
        out.push({
            tag: e.tagName,
            cls: String(typeof e.className === 'string' ? e.className : '').slice(0, 44),
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            t: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26),
            depth: (() => { let d = 0, p = e; while ((p = p.parentElement)) d++; return d; })(),
        });
    }
    out.sort((a, b) => a.y - b.y || a.depth - b.depth);
    return { viewportH: window.innerHeight, items: out };
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    const res = await cdp.call(inPageBands, o.from, o.to, o.minW, o.minH, o.xmax);

    console.log(`▸ 视口高 ${res.viewportH}；列出 y ∈ [${o.from}, ${o.to}] 的可见块（≥${o.minW}×${o.minH}）`);
    // 覆盖图：标出哪些横向「带」完全没被占用
    const covered = new Array(res.viewportH).fill(false);
    for (const it of res.items) {
        for (let y = Math.max(0, it.y); y < Math.min(res.viewportH, it.y + it.h); y++) covered[y] = true;
    }
    const gaps = [];
    let start = -1;
    for (let y = o.from; y < Math.min(o.to, res.viewportH); y++) {
        if (!covered[y]) { if (start < 0) start = y; }
        else if (start >= 0) { if (y - start >= 4) gaps.push([start, y - 1, y - start]); start = -1; }
    }
    if (start >= 0) gaps.push([start, Math.min(o.to, res.viewportH) - 1, Math.min(o.to, res.viewportH) - start]);

    for (const it of res.items) {
        console.log(`  ${String(it.y).padStart(4)}..${String(it.y + it.h).padStart(4)} (h${String(it.h).padStart(3)})  x${String(it.x).padStart(4)} w${String(it.w).padStart(4)}  d${it.depth}  ${it.tag} ${it.cls}  ${it.t}`);
    }
    console.log('\n▸ 未被任何块覆盖的横向空隙（≥4px）：');
    for (const g of gaps) console.log(`  y ${g[0]}..${g[1]}  高 ${g[2]}px`);
    if (gaps.length === 0) console.log('  （无）');
    cdp.close();
}

await main();
