#!/usr/bin/env node
/**
 * E10-② 取证：**WebGL context 的创建 / 释放生命周期**。
 *
 * 为什么需要它：`_dbg-e10b-whitescreen.mjs` 只能证明"每轮净增 N 个"，说不清是
 * **谁在建**、**谁没放**。这里把 `getContext` 与 `WEBGL_lose_context.loseContext()`
 * 都包一层，按调用栈分组统计，一次跑完就能指着某个调用点说"就是这里"。
 *
 * 实测得到的硬事实（模拟器 SwiftShader，2026-09-30）：
 *  · `getContext("webgl2")` **从不返回 null** —— 超限时 Chrome 直接**强制丢失最旧的**
 *    （所以"上一版修法"里靠 `getContext` 返回来判失败是错的）；
 *  · **同一时刻只能活 8 个**（不是常说的 16）；
 *  · `WEBGL_lose_context` 在**活着的** context 上 100% 可用，且 `loseContext()` 立刻生效。
 *
 * 用法：node scripts/_dbg-ctx-lifecycle.mjs [serial] [rounds]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内：装生命周期记录器。 */
function inPageArm() {
    const w = window;
    if (w.__hsCtxLife) return { already: true };
    const st = { events: [], created: 0, released: 0, live: 0, start: performance.now() };
    w.__hsCtxLife = st;

    /** 取调用栈里第一条**非本文件**的帧，作为"谁干的"指纹。 */
    const who = (skip) => {
        const e = new Error();
        const lines = String(e.stack || '').split('\n').slice(1, 12);
        for (const l of lines) {
            if (/ctx-lifecycle|__hsCtxLife/i.test(l)) continue;
            const m = l.match(/([A-Za-z0-9_$.\-]+\.js):(\d+):(\d+)/);
            if (m) return `${m[1].split('/').pop()}:${m[2]}`;
            const m2 = l.match(/at ([^(]+)\(/);
            if (m2) return m2[1].trim().slice(-40);
        }
        return '(unknown)';
    };

    const origGet = HTMLCanvasElement.prototype.getContext;
    const origExt = WebGL2RenderingContext.prototype.getExtension;
    const seen = new WeakMap();

    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const out = origGet.call(this, type, ...rest);
        const key = String(type);
        if (out !== null) {
            let set = seen.get(this);
            if (!set) {
                set = new Set();
                seen.set(this, set);
            }
            if (!set.has(key)) {
                set.add(key);
                /* 只看 WebGL：2d 不占那个 8 的额度。 */
                if (key === 'webgl2' || key === 'webgl') {
                    st.created += 1;
                    st.live += 1;
                    const attr =
                        (this.getAttribute('data-piano-roll-gl-scene') !== null ? 'piano:glScene' : '') +
                        (this.getAttribute('data-piano-roll-canvas') !== null ? '|piano:curve' : '') +
                        (this.getAttribute('data-waveform-renderer') ? '|wave' : '');
                    st.events.push({
                        t: Math.round(performance.now() - st.start),
                        k: 'new',
                        type: key,
                        attr,
                        size: this.width + 'x' + this.height,
                        live: st.live,
                        who: who(),
                    });
                }
            }
        }
        return out;
    };

    WebGL2RenderingContext.prototype.getExtension = function (name) {
        const ext = origExt.call(this, name);
        if (String(name) === 'WEBGL_lose_context' && ext && !ext.__hsWrapped) {
            const origLose = ext.loseContext.bind(ext);
            const patched = Object.create(ext);
            patched.loseContext = function () {
                st.released += 1;
                st.live -= 1;
                st.events.push({
                    t: Math.round(performance.now() - st.start),
                    k: 'lose',
                    live: st.live,
                    who: who(),
                });
                return origLose();
            };
            patched.__hsWrapped = true;
            return patched;
        }
        return ext;
    };
    return { already: false, start: st.start };
}

function inPageDump() {
    const st = window.__hsCtxLife;
    if (!st) return null;
    const group = (list) => {
        const m = new Map();
        for (const e of list) m.set(e.who, (m.get(e.who) || 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${k}`);
    };
    return {
        created: st.created,
        released: st.released,
        live: st.live,
        newsByWho: group(st.events.filter((e) => e.k === 'new')),
        losesByWho: group(st.events.filter((e) => e.k === 'lose')),
        last: st.events.slice(-24),
    };
}

async function main() {
    const serial = process.argv[2] || 'emulator-5554';
    const rounds = Number(process.argv[3] || 3);
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });

    console.log('▸ 装记录器：' + JSON.stringify(await cdp.call(inPageArm)));

    /* 起始：清一次基线（把当前已存在的画布记进 seen，避免算成本次创建） */
    await cdp.call(() => {
        for (const c of document.querySelectorAll('canvas')) c.getContext('webgl2');
        return true;
    });
    const before = await cdp.call(inPageDump);
    console.log('▸ 基线：' + JSON.stringify({ created: before.created, released: before.released, live: before.live }));

    async function drag(ratio) {
        const g = await cdp.call(() => {
            const h = document.querySelector('[data-hs-split-handle]');
            const cont = document.querySelector('[data-hs-mobile-split]');
            if (!h || !cont) return { error: 'no-handle' };
            const hr = h.getBoundingClientRect();
            const cr = cont.getBoundingClientRect();
            return { x: Math.round(hr.left + hr.width / 2), y0: Math.round(hr.top + hr.height / 2), top: Math.round(cr.top), h: Math.round(cr.height) };
        });
        if (g.error) return g;
        const y1 = Math.round(g.top + g.h * ratio);
        await touch('touchStart', [{ x: g.x, y: g.y0 }]);
        await sleep(90);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [{ x: g.x, y: Math.round(g.y0 + ((y1 - g.y0) * i) / 6) }]);
            await sleep(70);
        }
        await touch('touchEnd', []);
        await sleep(650);
        return { ok: true };
    }
    async function ensureSplit() {
        await cdp.call(() => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
            return true;
        });
        await sleep(900);
    }

    await ensureSplit();
    for (let i = 1; i <= rounds; i++) {
        await drag(0.92);
        const mid = await cdp.call(inPageDump);
        console.log(`  第 ${i} 轮（参数全屏）：created=${mid.created} released=${mid.released} live=${mid.live}`);
        await ensureSplit();
        const after = await cdp.call(inPageDump);
        console.log(`  第 ${i} 轮（回到分屏）：created=${after.created} released=${after.released} live=${after.live}`);
    }

    const end = await cdp.call(inPageDump);
    console.log(`\n累计：created=${end.created}  released=${end.released}  live=${end.live}`);
    console.log('\n【创建】按调用点分组：');
    for (const s of end.newsByWho) console.log('   ' + s);
    console.log('\n【释放】按调用点分组：');
    for (const s of end.losesByWho) console.log('   ' + s);
    console.log('\n最后 24 条事件：');
    for (const e of end.last) {
        console.log(`   t=${String(e.t).padStart(7)}ms  ${e.k === 'new' ? '新建' : '释放'}  live=${String(e.live).padStart(3)}  ${e.attr || ''}  ${e.who}`);
    }
    cdp.close();
}

await main();
