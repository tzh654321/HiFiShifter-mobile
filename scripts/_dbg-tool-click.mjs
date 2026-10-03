#!/usr/bin/env node
/**
 * #1 工具按钮点击语义 —— 用**真实触摸序列**测（合成 click 测不出 pointer 长按路径）。
 *
 * 用户口径：「点**未选中**的工具后直接切换；点**选中中**的才开菜单」—— 实测未通过。
 * 每轮先 reload 拿干净初始态，再切到参数面板（工具行在那儿）。
 * 四个落点各自回答一个问题：
 *   A 正中心      ⇒ 正常点击应**切换**
 *   B 中心 +(9,9) ⇒ 上一轮修的就是这个"偏右下被当成点角标"
 *   C 正中心慢按 450ms ⇒ 400ms 长按门槛会不会抢在 click 前开菜单
 *   D 中心 +(13,14)（角标外扩区）⇒ 角标该开菜单（规格如此）
 *
 * 用法：node scripts/_dbg-tool-click.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const port = 9227;

const stateFn = () => {
    const d = document.querySelector('[data-hs-draw-anchor]');
    const s = document.querySelector('[data-hs-select-anchor]');
    const db = d && d.closest('button');
    const sb = s && s.closest('button');
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const items = [...document.querySelectorAll('[role="menu"] *')]
        .map((n) => (n.textContent || '').trim())
        .filter((t) => t.length > 0 && t.length < 12);
    return {
        drawPressed: db ? db.getAttribute('aria-pressed') : null,
        drawExpanded: db ? db.getAttribute('aria-expanded') : null,
        selPressed: sb ? sb.getAttribute('aria-pressed') : null,
        drawTool: d ? d.getAttribute('data-hs-draw-tool') : null,
        drawRect: db ? rect(db) : null,
        selRect: sb ? rect(sb) : null,
        menuItems: items.slice(0, 8),
        hasSelMenu: Boolean(document.querySelector('[data-hs-select-tool-menu]')),
    };
};

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
    const state = () => cdp.call(stateFn);

    /** reload + 切到参数面板，返回干净状态。 */
    async function reset() {
        await cdp.send('Page.reload', { ignoreCache: false });
        await sleep(5200);
        await cdp.call(() =>
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } })),
        );
        await sleep(1200);
        return state();
    }

    const tap = async (x, y, hold = 80) => {
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(520);
    };

    /** 菜单项用**页内 `.click()`**（真实触摸点菜单项不稳定，且会叠一层 backdrop；
       页内点击是 React 的合成事件路径，可靠且不引入额外触摸）。 */
    const pickMenuByClick = (text) => cdp.call((tx) => {
        for (const root of document.querySelectorAll('[role="menu"]')) {
            for (const n of root.querySelectorAll('*')) {
                if (n.children.length !== 0) continue;
                if ((n.textContent || '').trim() !== tx) continue;
                const btn = n.closest('button') ?? n;
                btn.click();
                return { ok: true, text: tx };
            }
        }
        return { ok: false };
    }, text);

    /** 把工具模式切到「拖动」：点选择 ⇒ select；再点 ⇒ 开菜单；选「拖动」。 */
    async function toDragMode() {
        await reset();
        let st = await state();
        if (!st.selRect) { console.log('（找不到选择按钮）'); return null; }
        await tap(st.selRect.l + st.selRect.w / 2, st.selRect.t + st.selRect.h / 2);
        st = await state();
        console.log(`   切选择后：selPressed=${st.selPressed} 菜单=${JSON.stringify(st.menuItems)}`);
        if (!st.hasSelMenu) {
            await tap(st.selRect.l + st.selRect.w / 2, st.selRect.t + st.selRect.h / 2);
            st = await state();
        }
        let picked = await pickMenuByClick('拖动');
        if (!picked.ok) picked = await pickMenuByClick('Drag');
        if (!picked.ok) { console.log('（选择菜单里找不到「拖动」项）'); return null; }
        await sleep(600);
        const fin = await state();
        console.log(`   切到拖动：selPressed=${fin.selPressed} 菜单=${JSON.stringify(fin.menuItems)}`);
        return fin;
    }

    async function trial(label, dOff, hold, expectMenu = false) {
        console.log(`
── ${label} ──`);
        const before = await toDragMode();
        if (!before) return;
        const r = before.drawRect;
        if (!r) { console.log(`🔴 ${label}：找不到绘制按钮`); return; }
        const x = r.l + r.w / 2 + dOff.x;
        const y = r.t + r.h / 2 + dOff.y;
        console.log(`\n── ${label}  按钮=${r.w}×${r.h} 落点=(${x},${y}) 按住=${hold}ms ──`);
        console.log(`   点前：drawPressed=${before.drawPressed} selPressed=${before.selPressed} tool=${before.drawTool} 菜单=${JSON.stringify(before.menuItems)}`);
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        const during = await state();
        await touch('touchEnd', []);
        await sleep(700);
        const after = await state();
        console.log(`   按下中：菜单=${JSON.stringify(during.menuItems)} drawExpanded=${during.drawExpanded}`);
        console.log(`   点后：drawPressed=${after.drawPressed} tool=${after.drawTool} 菜单=${JSON.stringify(after.menuItems)}`);
        const hasMenu = (after.menuItems || []).length > 0;
        const switched = after.drawPressed === 'true' && !hasMenu;
        if (expectMenu) {
            console.log(`   ⇒ ${hasMenu ? '✅ 角标开菜单（规格如此）' : '🔴 角标没开菜单'}`);
        } else {
            console.log(`   ⇒ ${switched ? '✅ 直接切换（正确）' : '🔴 未切换 / 弹了菜单'}`);
        }
    }

    await trial('A 正中心 80ms', { x: 0, y: 0 }, 80);
    await trial('B 中心 +(9,9) 80ms', { x: 9, y: 9 }, 80);
    await trial('C 正中心 450ms（慢点）', { x: 0, y: 0 }, 450);
    await trial('D 中心 +(13,14)（角标位置，未激活 ⇒ 角标已退出命中）', { x: 13, y: 14 }, 80, false);

    /* E 口径的另一半：**已激活**时点按钮本体应"开菜单"（reload 后默认就是绘制态）。 */
    {
        console.log('');
        console.log('── E 已激活态点正中心 80ms（应开菜单）──');
        const st = await reset();
        const r = st.drawRect;
        if (!r) { console.log('🔴 找不到绘制按钮'); }
        else {
            const x = r.l + r.w / 2;
            const y = r.t + r.h / 2;
            console.log(`   点前 drawPressed=${st.drawPressed} 按钮=${r.w}×${r.h} 落点=(${x},${y})`);
            await touch('touchStart', [{ x, y }]);
            await sleep(80);
            await touch('touchEnd', []);
            await sleep(700);
            const after = await state();
            const hasMenu = (after.menuItems || []).length > 0;
            console.log(`   点后：菜单=${JSON.stringify(after.menuItems)}`);
            console.log(`   ⇒ ${hasMenu ? '✅ 已选中 ⇒ 开菜单（规格如此）' : '🔴 没开菜单'}`);
        }
    }

    cdp.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
