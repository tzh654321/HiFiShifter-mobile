#!/usr/bin/env node
/**
 * 读三个手机浮层的**层级**，判断它们会不会被"轨道头 / 拍数栏"盖住。
 *
 * 用户口径（2026-10-03）：「常用功能临时菜单、控制点、淡出与变速这两个临时窗口
 * **应可以显示在更高层级（如轨道头、拍数栏）**」。
 *
 * 手法：让三个浮层都出现在场（导入素材 → 选中块 → 长按圆点），然后
 *   ① 读各自的 computed `z-index` 与 rect；
 *   ② 在各自 rect 内**采样 `elementFromPoint`** —— 若返回的不是浮层自己（或其子元素），
 *      说明那个位置被别的东西占了（轨道头 / 拍数栏 / 面板）。
 *
 * 用法：node scripts/_dbg-layers-z.mjs 221deeb
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9231;
const wav = 'D:\\Temp\\hs-tone.wav';

function inPage() {
    const invoke = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
    return invoke('get_timeline_state').then((st) => {
        /** 从元素向上爬，取**层叠上下文链**（形成上下文的：有 z-index 且 position 非 static）。 */
        const chain = (el) => {
            const out = [];
            let n = el;
            for (let i = 0; n && i < 10; i += 1) {
                const cs = getComputedStyle(n);
                const formsCtx =
                    cs.position !== "static" &&
                    cs.zIndex !== "auto" &&
                    cs.transform === "none" &&
                    cs.filter === "none" &&
                    cs.opacity === "1";
                out.push({
                    tag: n.tagName.toLowerCase(),
                    sel: n.getAttribute("data-hs-surface") ||
                        n.getAttribute("data-hs-pane") ||
                        [...n.attributes].map((a) => a.name).filter((a) => a.startsWith("data-hs")).join(",") ||
                        (n.className && String(n.className).slice(0, 40)) ||
                        "",
                    pos: cs.position,
                    z: cs.zIndex,
                    ctx: formsCtx,
                });
                n = n.parentElement;
            }
            return out;
        };
        /** 在一个矩形内采样命中，返回"命中元素是否在期望子树里"。 */
        const probeRect = (el, name) => {
            const r = el.getBoundingClientRect();
            const pts = [
                [r.left + r.width * 0.5, r.top + r.height * 0.5],
                [r.left + 4, r.top + 4],
                [r.left + r.width - 4, r.top + r.height - 4],
                [r.left + 4, r.top + r.height - 4],
                [r.left + r.width - 4, r.top + 4],
            ];
            /* 🔴 必须用 `elementsFromPoint`（复数）：本层 `pointer-events:none` ⇒
               `elementFromPoint` 会**跳过它**，永远读到下面的内核容器 ⇒ 判据是假的。 */
            const samples = pts.map(([x, y]) => {
                if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return "outside";
                const stack = document.elementsFromPoint(Math.round(x), Math.round(y));
                const idx = stack.findIndex((n) => n === el || el.contains(n));
                const labelOf = (n) =>
                    [...n.attributes].map((a) => a.name).filter((a) => a.startsWith("data-hs")).join(",") ||
                    n.tagName.toLowerCase();
                return {
                    idx, // −1 = 不在该点的层序里（被别的东西完全遮住 / 点不在场）
                    selfLayer: idx >= 0 ? idx : null,
                    above: stack.slice(0, Math.max(1, idx)).map(labelOf).slice(0, 3),
                    top: stack[0] ? labelOf(stack[0]) : "null",
                };
            });
            return {
                name,
                rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
                z: getComputedStyle(el).zIndex,
                pos: getComputedStyle(el).position,
                samples,
                chain: chain(el),
            };
        };

        const out = { clips: st.clips.length, layers: [] };
        const actions = document.querySelector("[data-hs-clip-actions]");
        if (actions) out.layers.push(probeRect(actions, "常用功能浮条"));
        const cps = document.querySelector("[data-hs-clip-control-points]");
        if (cps) out.layers.push(probeRect(cps, "控制点容器"));
        const dot = document.querySelector('[data-hs-clip-control-point="right"]') ??
            document.querySelector('[data-hs-clip-control-point="left"]');
        if (dot) out.layers.push(probeRect(dot, "控制点圆点"));
        const hint = document.querySelector("[data-hs-edge-longpress-hint]");
        if (hint) {
            out.layers.push(probeRect(hint, "长按提示（整块）"));
            const fade = hint.querySelector('[data-hs-edge-hint="fade"]');
            const stretch = hint.querySelector('[data-hs-edge-hint="stretch"]');
            if (fade) out.layers.push(probeRect(fade, "提示·淡出"));
            if (stretch) out.layers.push(probeRect(stretch, "提示·变速"));
        }
        /* 参照物：轨道头列（x 0..131）与拍数栏（y 33..81 那条） */
        const row = document.querySelector("[data-hs-track-row]");
        if (row) {
            const r = row.getBoundingClientRect();
            const head = {
                rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
            };
            const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            head.midHit = hit
                ? [...hit.attributes].map((a) => a.name).filter((a) => a.startsWith("data-hs")).join(",") ||
                  hit.tagName.toLowerCase()
                : "null";
            out.trackHeaderSample = head;
        }
        return out;
    });
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

    /* 重置 + 导入 */
    for (let g = 0; g < 5; g += 1) {
        const cur = await cdp.call(() =>
            window.__TAURI_INTERNALS__.invoke("get_timeline_state").then((s) => s.clips.length),
        );
        if (!cur) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent("hifi:timelineEditOp", { detail: { op } }));
            fire("selectAll");
            fire("delete");
        });
        await sleep(800);
    }
    const b64 = readFileSync(wav).toString("base64");
    await cdp.call((n, b, at) => window.__hsImportAudioBase64(n, b, at), "layers", b64, 0.3);
    await sleep(1600);

    /* 点块中心选中 ⇒ 浮条 + 控制点出现 */
    const g = await cdp.call(() => {
        const vp = window.__hsViewport();
        const c = vp.containerRect;
        return { x: Math.round(c.left + 18), y: Math.round(c.top + 48) };
    });
    /* 先点一下**块下方空白**（清掉 `hiddenForClipId` / 取消选中），再点块 ——
       `ClipQuickActions` 的 `hs-hide-clip-actions` 会把该块收起，探针里必须先"复位"。 */
    const blank = await cdp.call(() => {
        const c = window.__hsViewport().containerRect;
        return { x: Math.round(c.left + c.width - 20), y: Math.round(c.top + c.height - 60) };
    });
    await touch("touchStart", [{ x: blank.x, y: blank.y }]);
    await sleep(80);
    await touch("touchEnd", []);
    await sleep(700);

    for (let i = 0; i < 4; i += 1) {
        await touch("touchStart", [{ x: g.x, y: g.y }]);
        await sleep(90);
        await touch("touchEnd", []);
        await sleep(700);
        const sel = await cdp.call(() => (window.__hsSelection ? window.__hsSelection() : null));
        const hasDot = await cdp.call(() => Boolean(document.querySelector("[data-hs-clip-control-point]")));
        if (sel && sel.clipId && hasDot) break;
    }

    /* 读 1：**未触摸圆点**时（浮条 + 控制点都在场；提示窗还没有） */
    const out = await cdp.call(inPage);
    console.log("=== 读 1（未触摸圆点）===");
    console.log(JSON.stringify(out, null, 1));

    /* 长按圆点 ⇒ 提示窗出现（浮条会被 `hs-hide-clip-actions` 收起） */
    const dot = await cdp.call(() => {
        const d = document.querySelector('[data-hs-clip-control-point="right"]') ??
            document.querySelector('[data-hs-clip-control-point="left"]');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (dot) {
        await touch("touchStart", [{ x: dot.x, y: dot.y }]);
        await sleep(700);
        const out2 = await cdp.call(inPage);
        console.log("=== 读 2（长按圆点中）===");
        console.log(JSON.stringify(out2, null, 1));
        await touch("touchEnd", []);
    }
    cdp.close();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
