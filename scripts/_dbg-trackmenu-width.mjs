#!/usr/bin/env node
/**
 * 量「轨道头长按菜单」的宽度：**默认轨**（compose 关）vs **合成轨**（compose 开）。
 *
 * 用户口径（2026-10-03）：「点击了『合成』的轨道的轨道头菜单太宽了，保持与默认轨道的
 * 菜单一样宽」⇒ 先拿两个真实宽度，再决定固定成多少。
 *
 * 用法：node scripts/_dbg-trackmenu-width.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9236;

function inPage() {
    const menu = document.querySelector("[data-track-ctx-menu]");
    if (!menu) return { menu: null };
    const r = menu.getBoundingClientRect();
    /* 每项的宽度 + 文本，找出是谁把菜单撑宽的 */
    const items = [...menu.querySelectorAll("button")].map((b) => {
        const br = b.getBoundingClientRect();
        return {
            text: (b.textContent || "").trim().slice(0, 18),
            w: Math.round(br.width),
            scrollW: b.scrollWidth,
        };
    });
    return {
        menu: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        items,
    };
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch { /* ignore */ }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });

    const rowInfo = await cdp.call(() => {
        const row = document.querySelector("[data-hs-track-row]");
        if (!row) return null;
        const r = row.getBoundingClientRect();
        /* compose 徽标：行内 20×20 的 IconButton（带 data-tooltip） */
        const btns = [...row.querySelectorAll("button")].map((b) => {
            const br = b.getBoundingClientRect();
            return {
                tooltip: b.getAttribute("data-tooltip"),
                w: Math.round(br.width),
                h: Math.round(br.height),
                x: Math.round(br.left + br.width / 2),
                y: Math.round(br.top + br.height / 2),
            };
        });
        return { row: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, btns };
    });
    console.log("轨道头行：", JSON.stringify(rowInfo?.row));
    console.log("行内按钮：", JSON.stringify(rowInfo?.btns));

    /** 长按轨道头（600ms）→ 读菜单 → 点空白关掉。 */
    async function openMenuAndMeasure(label) {
        const row = rowInfo.row;
        /* 起手点取行内 x+62：避开左侧颜色条与最左的名字/徽标（上一轮 E37 探针实测
           这个位置能稳定触发轨道头长按）。 */
        const px = row.x + 62;
        const py = row.y + Math.round(row.h / 2);
        await touch("touchStart", [{ x: px, y: py }]);
        await sleep(650);
        await touch("touchEnd", []);
        await sleep(700);
        const out = await cdp.call(inPage);
        console.log(`\n── ${label}  起手=(${px},${py}) ──`);
        if (!out.menu) { console.log("   （菜单没打开）"); return null; }
        console.log(`   菜单：${out.menu.w}×${out.menu.h} @ ${out.menu.x},${out.menu.y}`);
        for (const it of out.items ?? []) console.log(`     ${String(it.w).padStart(4)}px  ${it.text}`);
        /* 关掉菜单：点它自己之外 */
        await cdp.call(() => document.body.click());
        await sleep(500);
        return out.menu.w;
    }

    const wDefault = await openMenuAndMeasure("① 默认轨（compose 关）");

    /* 开启 compose：点那个 20×20 的徽标 */
    /* 精确定位：tooltip 就是「合成」（别用尺寸筛选 —— 14×14 的"更改轨道颜色"会先被选中）。 */
    const composeBtn = (rowInfo?.btns ?? []).find(
        (b) => typeof b.tooltip === "string" && b.tooltip.includes("合成"),
    );
    if (composeBtn) {
        console.log(`\n点 compose 徽标 @ (${composeBtn.x},${composeBtn.y}) tooltip=${composeBtn.tooltip}`);
        await touch("touchStart", [{ x: composeBtn.x, y: composeBtn.y }]);
        await sleep(90);
        await touch("touchEnd", []);
        await sleep(1200);
        const st = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke("get_timeline_state").then((s) => (s.tracks || []).map((t) => ({ id: t.id.slice(0, 8), compose: t.compose_enabled }))),
        );
        console.log("   开启后 tracks =", JSON.stringify(st));
    } else {
        console.log("\n（没找到 compose 徽标 ⇒ 跳过第二步）");
    }

    const wCompose = await openMenuAndMeasure("② 合成轨（compose 开）");

    console.log(`\n=== 宽度对比：默认轨 ${wDefault}px · 合成轨 ${wCompose}px ===`);
    cdp.close();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
