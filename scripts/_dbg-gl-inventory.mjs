#!/usr/bin/env node
/**
 * E10-② 第③步「降 context 数」取证：**页面里到底有几个 WebGL context，各自属于谁**。
 *
 * 为什么需要它：`_dbg-ctx-lifecycle.mjs` 给出 `live` 总数（已证明"每轮进 3 出 3"），
 * 但说不清这 N 个里**哪些还在 DOM、哪些是已卸载画布上的孤儿**，也说不清
 * **哪条交互路径**会把它推高。而"降 context 数"要动的恰恰是这些。
 *
 * 【必须重载页面】包装 `getContext` 只能拦"装完之后"的创建；app 启动期那一批
 * 必须在**页面加载前**注入才拦得住 ⇒ 用 CDP `Page.addScriptToEvaluateOnNewDocument`
 * 注入，再 `Page.reload`。
 *
 * 【读数口径】`live` 只数"未丢失"的；`orphan` = 未丢失 **且不在 DOM** 的。
 * 【两段读数】`rounds=0` 时只报"干净启动态"；给定 rounds 则先报干净态，再跑 N 轮
 * **拖分屏手柄**（复刻用户口径的交互路径）后重报 —— 两者的差就是该路径造成的累积。
 *
 * 用法：node scripts/_dbg-gl-inventory.mjs [serial] [rounds]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在**页面加载前**注入：把每个新建的 webgl/webgl2 canvas 记进可枚举数组（诊断期持强引用）。 */
const ARM_SRC = `(function(){
  try { delete window.__hsInv; } catch (e) {}
  window.__hsInv = { list: [] };
  var orig = HTMLCanvasElement.prototype.getContext;
  var seen = new WeakMap();
  HTMLCanvasElement.prototype.getContext = function(type){
    var out = null;
    try { out = orig.apply(this, arguments); } catch (e) { out = null; }
    var key = String(type);
    if (out !== null && (key === 'webgl2' || key === 'webgl')) {
      var s = seen.get(this);
      if (!s) { s = new Set(); seen.set(this, s); }
      if (!s.has(key)) {
        s.add(key);
        window.__hsInv.list.push({ canvas: this, kind: key, at: performance.now() });
      }
    }
    return out;
  };
  window.__hsInv.dump = function(){
    var rows = window.__hsInv.list.map(function(e, i){
      var c = e.canvas, ctx = null;
      try { ctx = c.getContext('webgl2') || c.getContext('webgl'); } catch (err) { ctx = null; }
      var pane = c.closest('[data-hs-pane]');
      return {
        i: i, kind: e.kind, at: Math.round(e.at),
        inDom: c.isConnected ? 1 : 0, w: c.width, h: c.height,
        cls: String(c.className || '').slice(0, 30),
        scene: c.hasAttribute('data-piano-roll-gl-scene') ? 1 : 0,
        pane: pane ? String(pane.getAttribute('data-hs-pane')) : '',
        wave: String(c.getAttribute('data-waveform-renderer') || ''),
        lost: ctx ? (ctx.isContextLost() ? 1 : 0) : -1
      };
    });
    var live = rows.filter(function(r){ return r.lost === 0; }).length;
    var orphan = rows.filter(function(r){ return r.lost === 0 && r.inDom === 0; }).length;
    return {
      total: rows.length, live: live, orphan: orphan,
      domCanvas: document.querySelectorAll('canvas').length, rows: rows
    };
  };
})();`;

/** 页面内：手柄位置与容器几何（复刻用户口径所需）。 */
function inPageHandle() {
    const h = document.querySelector('[data-hs-split-handle]');
    const cont = document.querySelector('[data-hs-mobile-split]');
    if (!h || !cont) return { error: 'no-handle-or-container' };
    const hr = h.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    return {
        handle: { x: Math.round(hr.left + hr.width / 2), y: Math.round(hr.top + hr.height / 2) },
        container: { top: Math.round(cr.top), h: Math.round(cr.height) },
    };
}

function inPageEnsureSplit() {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    return true;
}

function report(label, d) {
    console.log(
        `\n【${label}】webgl canvas 共 ${d.total} 个；live(未丢失)=${d.live}，孤儿(未丢失且不在DOM)=${d.orphan}；` +
            `当前 DOM canvas=${d.domCanvas}`,
    );
    console.log('  序号 kind     记录时刻  inDom  尺寸        lost scene pane    wave  class');
    for (const r of d.rows) {
        console.log(
            `  #${String(r.i).padStart(3)} ${r.kind.padEnd(7)} ${String(r.at).padStart(7)}ms ` +
                `${String(r.inDom).padStart(5)}  ${String(r.w + 'x' + r.h).padEnd(10)} ` +
                `${String(r.lost).padStart(4)} ${String(r.scene).padStart(5)} ${(r.pane || '-').padEnd(6)} ` +
                `${(r.wave || '-').padEnd(5)} ${JSON.stringify(r.cls)}`,
        );
    }
}

async function main() {
    const serial = process.argv[2] || 'emulator-5554';
    const rounds = Number(process.argv[3] || 0);
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
        .toString()
        .trim()
        .replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: ARM_SRC });
    console.log('▸ 已在页面加载前注入清单记录器，正在重载页面…');
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(9000);

    const dump = () => cdp.call(function () {
        return window.__hsInv ? window.__hsInv.dump() : { error: 'not-armed', rows: [] };
    });

    await cdp.call(inPageEnsureSplit);
    await sleep(2000);
    const base = await dump();
    report('干净启动 + 分屏态', base);

    if (rounds > 0) {
        const touch = (type, pts) =>
            cdp.send('Input.dispatchTouchEvent', {
                type,
                touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
            });
        for (let i = 1; i <= rounds; i++) {
            const g = await cdp.call(inPageHandle);
            if (g.error) {
                console.log(`  第 ${i} 轮：${g.error}`);
                break;
            }
            const y0 = g.handle.y;
            const y1 = Math.round(g.container.top + g.container.h * 0.92); // ⇒ 拖到参数全屏
            const x = g.handle.x;
            await touch('touchStart', [{ x, y: y0 }]);
            await sleep(80);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [{ x, y: Math.round(y0 + ((y1 - y0) * k) / 6) }]);
                await sleep(60);
            }
            await touch('touchEnd', []);
            await sleep(500);
            await cdp.call(inPageEnsureSplit);
            await sleep(700);
        }
        const after = await dump();
        report(`${rounds} 轮「拖手柄切全屏/分屏」之后`, after);
        console.log(
            `\n▸ 累积：live ${base.live} → ${after.live}（+${after.live - base.live}）；` +
                `记录总数 ${base.total} → ${after.total}（+${after.total - base.total}）`,
        );
    }
    cdp.close();
}

await main();
