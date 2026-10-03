#!/usr/bin/env node
/**
 * 工具按钮「点击」的事件链取证：pointerdown / pointerup / **click** 各自有没有到、
 * target 是谁、相距多久。用来区分两件事：
 *   A. `click` **没生成**（CDP 合成触摸的伪影）⇒ 探针红是假的，产品可能没问题；
 *   B. `click` 到了 button，却仍开菜单 ⇒ 产品侧判定（`isDrawActive`）有问题。
 *
 * 用法：node scripts/_dbg-tool-event-chain.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9230;

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    try { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); } catch { /* ignore */ }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const tap = async (x, y, hold = 90) => {
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(600);
    };

    /* 干净起点 */
    await cdp.send('Page.reload');
    await sleep(5200);
    await cdp.call(() =>
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } })),
    );
    await sleep(1200);

    /* 装事件记录器 */
    await cdp.call(() => {
        window.__ev = [];
        const attrsOf = (el) =>
            [...el.attributes].map((a) => a.name).filter((a) => a.startsWith('data-hs')).join(',');
        const rec = (t, e) => {
            const el = e.target;
            window.__ev.push({
                t,
                tag: el.tagName.toLowerCase(),
                attrs: attrsOf(el),
                targetBtn: el.closest ? (el.closest('button') ? attrsOf(el.closest('button')) || 'button' : null) : null,
                x: e.clientX,
                y: e.clientY,
                ts: Math.round(performance.now()),
            });
        };
        const recBtn = (t, e) => {
            const el = e.target;
            const b = el.closest ? el.closest('button') : null;
            window.__ev.push({
                t: t + '@btn',
                tag: b ? 'button' : 'none',
                attrs: b ? attrsOf(b).slice(0, 60) : '',
                ts: Math.round(performance.now()),
            });
        };
        window.addEventListener('pointerdown', (e) => rec('pd', e), true);
        window.addEventListener('pointerup', (e) => rec('pu', e), true);
        window.addEventListener('click', (e) => { rec('click', e); recBtn('click', e); }, true);
        window.addEventListener('contextmenu', (e) => rec('ctxmenu', e), true);
    });

    const geo = await cdp.call(() => {
        const d = document.querySelector('[data-hs-draw-anchor]');
        const b = d ? d.closest('button') : null;
        const r = b.getBoundingClientRect();
        return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            pressed: b.getAttribute('aria-pressed'),
        };
    });
    console.log('绘制按钮中心 =', JSON.stringify(geo));

    // 切到「拖动」态
    await cdp.call(() => {
        const s = document.querySelector('[data-hs-select-anchor]');
        const sb = s.closest('button');
        const r = sb.getBoundingClientRect();
        window.__sel = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    const sel = await cdp.call(() => window.__sel);
    await tap(sel.x, sel.y);
    await tap(sel.x, sel.y);
    const pick = await cdp.call(() => {
        for (const root of document.querySelectorAll('[role="menu"]')) {
            for (const n of root.querySelectorAll('*')) {
                if (n.children.length !== 0) continue;
                if ((n.textContent || '').trim() !== '拖动') continue;
                const btn = n.closest('button') ?? n;
                const r = btn.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
        }
        return null;
    });
    if (pick) await tap(pick.x, pick.y);
    const before = await cdp.call(() => {
        const d = document.querySelector('[data-hs-draw-anchor]');
        const b = d.closest('button');
        return { drawPressed: b.getAttribute('aria-pressed'), menus: document.querySelectorAll('[role="menu"]').length };
    });
    console.log('切到拖动后：', JSON.stringify(before));

    /* 同一次会话里同时读 geometry + elementFromPoint + DPR（避免跨会话状态漂移）。 */
    const probe = await cdp.call(() => {
        const d = document.querySelector('[data-hs-draw-anchor]');
        const b = d.closest('button');
        const br = b.getBoundingClientRect();
        const cx = Math.round(br.left + br.width / 2);
        const cy = Math.round(br.top + br.height / 2);
        const c = document.querySelector('[data-hs-draw-corner]');
        const cr = c ? c.getBoundingClientRect() : null;
        const at = (x, y) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return 'null';
            const a = [...el.attributes].map((n) => n.name).filter((n) => n.startsWith('data-hs')).join(',');
            return el.tagName.toLowerCase() + (a ? '[' + a + ']' : '');
        };
        /* 中心 + 四角 + 角标中心，扫一遍看谁在哪 */
        const grid = [];
        for (const dy of [-12, 0, 12]) {
            for (const dx of [-12, 0, 12]) {
                grid.push(`${dx},${dy}=${at(cx + dx, cy + dy)}`);
            }
        }
        return {
            dpr: window.devicePixelRatio,
            innerW: window.innerWidth,
            btn: `${Math.round(br.left)},${Math.round(br.top)} ${Math.round(br.width)}x${Math.round(br.height)}`,
            outerSpan: (() => {
                const sp = d.querySelector('span');
                const r = sp.getBoundingClientRect();
                return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
            })(),
            cornerRect: cr ? `${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)}` : null,
            cornerCenterHit: cr ? at(Math.round(cr.left + cr.width / 2), Math.round(cr.top + cr.height / 2)) : null,
            grid,
        };
    });
    console.log('同会话几何：', JSON.stringify(probe, null, 1));

    /* 清空记录器，点绘制中心 */
    await cdp.call(() => { window.__ev = []; });
    console.log('—— 点绘制按钮中心 ——');
    await tap(geo.x, geo.y, 90);
    const ev = await cdp.call(() => window.__ev);
    for (const e of ev) console.log('  ', JSON.stringify(e));
    const after = await cdp.call(() => {
        const d = document.querySelector('[data-hs-draw-anchor]');
        const b = d.closest('button');
        return { drawPressed: b.getAttribute('aria-pressed'), menus: document.querySelectorAll('[role="menu"]').length };
    });
    console.log('点击后：', JSON.stringify(after));

    cdp.close();
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
