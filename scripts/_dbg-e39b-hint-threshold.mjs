#!/usr/bin/env node
/**
 * 验证本轮 ②③：圆点长按阈值（200ms）+ 「滑到"王"的上下边后提示窗消失」。
 *
 * 时序：导入 → 选中块 → 截图 A（浮条/控制点）
 *      → 按住圆点 300ms（> 新阈值 200）→ 读 hint 在场 + 截图 B
 *      → 上划 3 步（越过 MODE_THRESHOLD 18px ⇒ 进上横轨）→ 读 hint（应**已收起**）+ mode
 *      → 截图 C → 抬手
 *
 * 用法：node scripts/_dbg-e39b-hint-threshold.mjs 221deeb
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9232;
const wav = 'D:\\Temp\\hs-tone.wav';
const OUT = 'D:\\hifishifter-out';

function inPage() {
    const hint = document.querySelector("[data-hs-edge-longpress-hint]");
    const dot =
        document.querySelector('[data-hs-clip-control-point="right"]') ??
        document.querySelector('[data-hs-clip-control-point="left"]');
    return {
        hintOn: Boolean(hint),
        hintSide: hint ? hint.getAttribute("data-hs-edge-side") : null,
        mode: dot ? dot.getAttribute("data-hs-control-mode") : null,
        dot: dot
            ? (() => {
                  const r = dot.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              })()
            : null,
        sel: window.__hsSelection ? window.__hsSelection() : null,
    };
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch { /* ignore */ }

    const shot = (name) => {
        execSync(`adb -s ${serial} exec-out screencap -p > "${OUT}\\\\${name}"`, { shell: 'cmd.exe' });
    };
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });

    /* 重置 + 导入 + 选中 */
    for (let g = 0; g < 5; g += 1) {
        const n = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke("get_timeline_state").then((s) => s.clips.length),
        );
        if (!n) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent("hifi:timelineEditOp", { detail: { op } }));
            fire("selectAll");
            fire("delete");
        });
        await sleep(800);
    }
    await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), "hint", readFileSync(wav).toString("base64"), 0.3);
    await sleep(1600);
    const g = await cdp.call(() => {
        const c = window.__hsViewport().containerRect;
        return { x: Math.round(c.left + 20), y: Math.round(c.top + 48) };
    });
    let st = null;
    for (let i = 0; i < 4; i += 1) {
        await touch("touchStart", [{ x: g.x, y: g.y }]);
        await sleep(90);
        await touch("touchEnd", []);
        await sleep(700);
        st = await cdp.call(inPage);
        if (st.sel && st.sel.clipId && st.dot) break;
    }
    console.log("选中后：", JSON.stringify(st));
    shot("_e39b-A-selected.png");

    if (!st.dot) { console.log("（没有圆点，无法继续）"); cdp.close(); return; }

    /* 按住 300ms（> 新阈值 200ms） */
    await touch("touchStart", [{ x: st.dot.x, y: st.dot.y }]);
    await sleep(300);
    const afterHold = await cdp.call(inPage);
    console.log("按住 300ms：", JSON.stringify({ hintOn: afterHold.hintOn, side: afterHold.hintSide, mode: afterHold.mode }));
    shot("_e39b-B-hold300.png");

    /* 上划 2 步 × 12px = 24px > MODE_THRESHOLD 18 ⇒ 进上横轨(fade) */
    for (let i = 1; i <= 2; i += 1) {
        await touch("touchMove", [{ x: st.dot.x, y: st.dot.y - 12 * i }]);
        await sleep(80);
    }
    const afterSwipe = await cdp.call(inPage);
    console.log("上划后：", JSON.stringify({ hintOn: afterSwipe.hintOn, mode: afterSwipe.mode }));
    shot("_e39b-C-swiped.png");

    await touch("touchEnd", []);
    await sleep(500);
    console.log(`截图：${OUT}\\_e39b-A-selected.png / -B-hold300.png / -C-swiped.png`);
    cdp.close();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
