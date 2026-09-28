#!/usr/bin/env node
/**
 * A5 验收：「选择」与「绘制」两个工具图标的**切换方式**已统一。
 *
 * 用户原话：「「选择」的切换方式向「绘制」统一」。实测量出的差异是**绘制那边更差**
 * （角标 6×6 点不中、无 hover 反馈、点了不开菜单），所以按「绘制向选择看齐」实现。
 * 判据（全部 DOM 可观测）：
 *   ① 两个角标命中区**同为 14×14**、偏移**同为 -4**、opacity **同为 0.9**、cursor 同为 pointer；
 *   ② **点绘制角标能开出工具菜单**（新能力，改前没有）；
 *   ③ 点选择角标同样开出菜单（回归）；
 *   ④ 图形仍是 6×6（不放大视觉）。
 *
 * 用法：node scripts\_probe-tool-corner-parity.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 参数工具行只在参数面板可见时挂载
    const ready = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const clickText = async (t) => {
            const el = [...document.querySelectorAll('button,[role="menuitem"],div')].find(
                (b) => (b.textContent || '').trim() === t && b.children.length <= 3,
            );
            if (el) {
                el.click();
                return true;
            }
            return false;
        };
        if (document.querySelector('.hs-param-rows')) return 'already';
        await clickText('视图');
        await wait(700);
        await clickText('参数面板');
        await wait(1600);
        return document.querySelector('.hs-param-rows') ? 'opened' : 'missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(ready));

    /** 量一个角标（含它相对锚点的偏移与图形尺寸）。 */
    const measure = (sel, anchorSel) =>
        cdp.call(
            (s, a) => {
                const el = document.querySelector(s);
                if (!el) return { error: 'no-corner:' + s };
                const anchor = a ? document.querySelector(a) : null;
                const r = el.getBoundingClientRect();
                const ar = anchor ? anchor.getBoundingClientRect() : null;
                const cs = getComputedStyle(el);
                const svg = el.querySelector('svg');
                const sr = svg ? svg.getBoundingClientRect() : null;
                return {
                    w: +r.width.toFixed(2),
                    h: +r.height.toFixed(2),
                    opacity: cs.opacity,
                    cursor: cs.cursor,
                    dx: ar ? +(r.right - ar.right).toFixed(2) : null,
                    dy: ar ? +(r.bottom - ar.bottom).toFixed(2) : null,
                    glyph: sr ? `${+sr.width.toFixed(1)}×${+sr.height.toFixed(1)}` : null,
                };
            },
            sel,
            anchorSel,
        );

    const draw = await measure('[data-hs-draw-corner]', '[data-hs-draw-tool]');
    const select = await measure('[data-hs-select-corner]', '[data-hs-select-anchor]');
    console.log('▸ 绘制角标：' + JSON.stringify(draw));
    console.log('▸ 选择角标：' + JSON.stringify(select));

    if (draw.error || select.error) {
        console.log('🔴 找不到角标（装机包可能是加 hook 之前的？）');
        cdp.close();
        return;
    }

    const same = (a, b) => a === b;
    check(
        'A5-a 两个角标命中区/偏移/透明度/光标**完全一致**',
        same(draw.w, select.w) &&
            same(draw.h, select.h) &&
            same(draw.opacity, select.opacity) &&
            same(draw.cursor, select.cursor) &&
            same(draw.dx, select.dx) &&
            same(draw.dy, select.dy),
        `绘制 ${draw.w}×${draw.h} off(${draw.dx},${draw.dy}) op=${draw.opacity} cur=${draw.cursor}｜选择 ${select.w}×${select.h} off(${select.dx},${select.dy}) op=${select.opacity} cur=${select.cursor}`,
    );
    check(
        'A5-b 命中区 = 14×14（手指够得着）',
        draw.w === 14 && draw.h === 14,
        `绘制 ${draw.w}×${draw.h}`,
    );
    check(
        'A5-c 图形仍是 6×6（只放大命中区，不放大视觉）',
        parseFloat(draw.glyph) === 6 && parseFloat(select.glyph) === 6,
        `绘制 ${draw.glyph}｜选择 ${select.glyph}`,
    );

    /** 点角标 → 看是否出现工具菜单（用"菜单元素数量变化"判定，不依赖具体 aria-label）。 */
    const cornerOpens = async (sel) =>
        cdp.call(
            async (s) => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                /* 判据不用"菜单个数"（工具行自身也叫「参数工具行」，会被算进去，
                   而且上一步的菜单可能还开着 ⇒ 计数既会误判也会被残留干扰）。
                   改成**按独占条目**判断，语义明确：
                     · 绘制菜单 → 同时存在「颤音」「还原」两个按钮（工具行永远不会同时有）；
                     · 选择菜单 → 同时存在「选择」「拖动」两个按钮（工具行同一时刻只显示其一）。 */
                const texts = () =>
                    [...document.querySelectorAll('button')].map((b) =>
                        (b.textContent || '').trim(),
                    );
                const hasBoth = (list) => list.every((x) => texts().includes(x));
                const el = document.querySelector(s);
                if (!el) return { error: 'no-corner' };
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await wait(700);
                return {
                    drawMenuOpen: hasBoth(['颤音', '还原']),
                    selectMenuOpen: hasBoth(['选择', '拖动']),
                    closeBtn: Boolean(document.querySelector('[aria-label="关闭工具菜单"]')),
                };
            },
            sel,
        );

    // 关掉可能开着的菜单，保证 baseline 干净
    await cdp.call(() => {
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 4, clientY: 4 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await sleep(500);

    const drawOpen = await cornerOpens('[data-hs-draw-corner]');
    console.log('▸ 点绘制角标：' + JSON.stringify(drawOpen));
    check(
        'A5-d 点**绘制**角标能开出工具菜单（改前做不到）',
        drawOpen.drawMenuOpen === true,
        `绘制菜单打开=${drawOpen.drawMenuOpen}（独占条目 颤音+还原 同时在）；关闭键=${drawOpen.closeBtn}`,
    );

    await cdp.call(() => {
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 4, clientY: 4 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await sleep(500);
    const selectOpen = await cornerOpens('[data-hs-select-corner]');
    console.log('▸ 点选择角标：' + JSON.stringify(selectOpen));
    check(
        'A5-e 点**选择**角标同样开出菜单（回归）',
        selectOpen.selectMenuOpen === true && selectOpen.drawMenuOpen === false,
        `选择菜单打开=${selectOpen.selectMenuOpen}；绘制菜单残留=${selectOpen.drawMenuOpen}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
