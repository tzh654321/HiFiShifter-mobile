#!/usr/bin/env node
/**
 * E10-① 复现与逐层量测：**参数界面全屏后不满屏**（用户：能稳定复现）。
 *
 * 关键修正（前几轮"切不动面板"的原因）：
 *   · 面板开关走**「视图」菜单**，但菜单项要**等菜单真正打开**后再枚举
 *     （`role=menuitem` 本身是对的；之前一打开就枚举，拿到空数组 ⇒ 点击全落空）；
 *   · 参数面板画布选择器 = `data-piano-roll-canvas`。
 *
 * 量测：从参数画布向上逐层打印 rect / flex / height —— 直接看出哪一层没占满视口。
 *
 * 用法：node scripts\_probe-e10-notfull2.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const PANELS = () =>
        cdp.call(() => ({
            timeline: Boolean(document.querySelector('[data-hs-surface="timeline"]')),
            params: Boolean(document.querySelector('[data-piano-roll-canvas]')),
        }));

    /* 菜单必须用**真触摸**驱动：radix DropdownMenu 靠 pointerdown 接管，
       合成 `.click()` 只对部分元素有效（实测：有时菜单根本没打开、有时点了不生效）。 */
    const tapAt = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(700);
    };

    const menuPick = async (label) => {
        // 1) 点「视图」（真触摸）
        const trig = await cdp.call(() => {
            const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!trig) return { ok: false, why: 'no-view-menu' };
        await tapAt(trig.x, trig.y);
        await sleep(900);
        // 2) 找菜单项（等菜单真正打开）
        const item = await cdp.call((lb) => {
            const items = [...document.querySelectorAll('[role=menuitem]')];
            const it = items.find((x) => (x.textContent || '').replace(/[✓\s]/g, '').startsWith(lb));
            if (!it) return { found: false, saw: items.map((x) => (x.textContent || '').trim().slice(0, 10)) };
            const r = it.getBoundingClientRect();
            return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), checked: it.getAttribute('aria-checked') };
        }, label);
        if (!item.found) {
            await tapAt(10, 400); // 点别处收起菜单
            return { ok: false, why: 'no-item', saw: item.saw };
        }
        await tapAt(item.x, item.y);
        await sleep(1900);
        return { ok: true, wasChecked: item.checked };
    };

    const chain = () =>
        cdp.call(() => {
            const canvas = document.querySelector('[data-piano-roll-canvas]');
            if (!canvas) return { error: 'no-params-canvas', vw: window.innerWidth, vh: window.innerHeight, chain: [] };
            const out = [];
            let el = canvas;
            for (let i = 0; i < 9 && el; i++) {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                out.push({
                    lvl: i,
                    tag: el.tagName.toLowerCase(),
                    cls: String(el.className || '').slice(0, 44),
                    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                    display: cs.display,
                    grow: cs.flexGrow,
                    basis: cs.flexBasis,
                    h: cs.height,
                    pos: cs.position,
                });
                el = el.parentElement;
            }
            return { vw: window.innerWidth, vh: window.innerHeight, chain: out };
        });

    const show = (tag, d) => {
        console.log(`\n▸ ${tag}（视口 ${d.vw}×${d.vh}）`);
        if (d.error) {
            console.log('   ' + d.error);
            return;
        }
        for (const c of d.chain) {
            console.log(
                `   lvl${c.lvl} ${c.tag} [${c.rect.join(',')}] display=${c.display} grow=${c.grow} basis=${c.basis} h=${c.h} pos=${c.pos} cls="${c.cls}"`,
            );
        }
    };

    console.log('▸ 初始面板：' + JSON.stringify(await PANELS()));
    if (!(await PANELS()).params) {
        console.log('▸ 打开参数面板：' + JSON.stringify(await menuPick('参数面板')));
        await sleep(1200);
    }
    console.log('▸ 分屏态：' + JSON.stringify(await PANELS()));
    const splitChain = await chain();
    show('分屏态·祖先链', splitChain);

    console.log('\n▸ 取消轨道面板：' + JSON.stringify(await menuPick('轨道面板')));
    await sleep(1500);
    console.log('▸ 全屏态面板：' + JSON.stringify(await PANELS()));
    const fullChain = await chain();
    show('全屏态·祖先链', fullChain);

    const cr = fullChain.chain?.[0]?.rect;
    const cover = cr ? Math.round(((cr[2] * cr[3]) / (fullChain.vw * fullChain.vh)) * 100) : null;
    console.log('\n════════ 速览 ════════');
    console.log(`· 分屏：画布 rect=[${splitChain.chain?.[0]?.rect.join(',')}]`);
    console.log(`· 全屏：画布 rect=[${cr?.join(',')}]  占屏 ${cover}%`);
    console.log('· 若未占满：看祖先链里哪一层的 h 明显小于视口高度（或 y 明显大于 0）');
    cdp.close();
};

await main();
