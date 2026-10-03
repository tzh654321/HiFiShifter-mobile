#!/usr/bin/env node
/** 验证工具按钮**正中心**命中的到底是不是那个角标（`data-hs-draw-corner`）。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const port = 9229;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inPage() {
    const d = document.querySelector('[data-hs-draw-anchor]');
    const btn = d ? d.closest('button') : null;
    if (!btn) return { err: 'no button' };
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const chainAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        const out = [];
        let n = el;
        for (let i = 0; n && i < 6; i += 1) {
            const attrs = [...n.attributes]
                .map((a) => a.name)
                .filter((a) => a.startsWith('data-hs'))
                .join(',');
            const b = n.getBoundingClientRect();
            out.push(
                `${n.tagName.toLowerCase()}${attrs ? '[' + attrs + ']' : ''}@${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`,
            );
            n = n.parentElement;
        }
        return out;
    };
    const corner = document.querySelector('[data-hs-draw-corner]');
    const cr = corner ? corner.getBoundingClientRect() : null;
    const menuOpen = Boolean(
        document.querySelector('[data-hs-draw-tool-menu], [data-hs-select-tool-menu]'),
    );
    return {
        btn: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        center: `${cx},${cy}`,
        menuOpen,
        cornerRect: cr ? `${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)}` : null,
        cornerInCenter: cr
            ? cx >= cr.left && cx <= cr.right && cy >= cr.top && cy <= cr.bottom
            : null,
        chainAtCenter: chainAt(cx, cy),
        chainAtCorner: cr
            ? chainAt(Math.round(cr.left + cr.width / 2), Math.round(cr.top + cr.height / 2))
            : null,
    };
}

async function main() {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:${port} localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    /* 关键：先 reload 拿到**干净**状态（上一次操作可能把菜单留着 ⇒ backdrop 是全屏
       button，会把 elementFromPoint 全遮住，读出来的结论是假的）。 */
    await cdp.send('Page.reload');
    await sleep(5200);
    await cdp.call(() =>
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } })),
    );
    await sleep(1200);
    const out = await cdp.call(inPage);
    console.log(JSON.stringify(out, null, 1));
    cdp.close();
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
