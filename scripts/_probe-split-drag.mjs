#!/usr/bin/env node
/**
 * C5 / C6 验收：手机分屏的**手柄拖动**。
 *
 * 规格（用户原话）：
 *   C5 全屏非轨道界面**从顶部下拉进分屏**（轨道 + 先前界面），分界线可拖，
 *      拖到很接近底部/顶部时**变回全屏**；
 *   C6 上下拖动 参数界面拍数栏 / 文件管理标题栏 / 记事本标题栏 可**改分屏边界**；
 *      某一界面过小则**自动关闭**。
 *
 * 实现（`App.tsx`）：document 捕获阶段 pointerdown → `[data-hs-split-handle]`
 * 或 `[data-hs-time-ruler="params"]`；非鼠标才接管；位移 > 14px 才动；直接改分屏容器
 * 两个子块的 `flexGrow`；抬手时 ratio ≥ 0.86 ⇒ 关掉非轨道面板，ratio ≤ 0.14 ⇒ 关掉轨道。
 *
 * ⚠️ 每一步都**先复位到分屏**再测 —— 拖动会真的关面板（这正是 C6 的自动关闭），
 *    不复位的话下一步起点就不是你以为的状态（上一版就是这么误判的）。
 * ⚠️ 用**合成 PointerEvent**（`pointerType: "touch"`）驱动，与 D2/D5 探针同一手法。
 *
 * 用法：node scripts\_probe-split-drag.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

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

    const state = () =>
        cdp.call(() => {
            const c = document.querySelector('[data-hs-mobile-split]');
            const kids = c
                ? [...c.children].map((el) => {
                      const r = el.getBoundingClientRect();
                      return {
                          grow: +getComputedStyle(el).flexGrow,
                          top: Math.round(r.top),
                          h: Math.round(r.height),
                      };
                  })
                : [];
            const vis = (s) => {
                const el = document.querySelector(s);
                if (!el) return false;
                const r = el.getBoundingClientRect();
                return r.height > 8 && r.width > 8;
            };
            return {
                kids,
                timeline: vis('[data-hs-surface="timeline"]'),
                params: vis('[data-hs-surface="pianoRoll"]'),
                handles: [
                    ...document.querySelectorAll(
                        '[data-hs-split-handle], [data-hs-time-ruler="params"]',
                    ),
                ]
                    .filter((e) => e.getBoundingClientRect().height > 4)
                    .map((e) => e.getAttribute('data-hs-split-handle') ?? 'paramsRuler'),
            };
        });

    const clickMenuItem = (text) =>
        cdp.call(
            async (t) => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const b = [...document.querySelectorAll('button')].find(
                    (x) => (x.textContent || '').trim() === '视图',
                );
                if (b) b.click();
                await wait(700);
                const item = [...document.querySelectorAll('button,[role="menuitem"],div')].find(
                    (x) => (x.textContent || '').trim() === t && x.children.length <= 3,
                );
                if (!item) {
                    window.dispatchEvent(
                        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
                    );
                    return 'no-item:' + t;
                }
                item.click();
                await wait(1400);
                return 'ok';
            },
            text,
        );

    /** 复位：确保「参数面板 + 轨道面板」同时可见（= 分屏）。 */
    const ensureSplit = async () => {
        for (let i = 0; i < 4; i++) {
            const s = await state();
            if (s.timeline && s.params) return s;
            await clickMenuItem(s.params ? '轨道面板' : '参数面板');
        }
        return state();
    };

    /** 在某个手柄上拖：位移为正 = 向下。 */
    const dragHandle = async (sel, dy) => {
        const before = await state();
        const ok = await cdp.call(
            async (s, delta) => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const el = document.querySelector(s);
                if (!el) return 'no-handle';
                const r = el.getBoundingClientRect();
                const x = Math.round(r.left + Math.min(40, r.width / 2));
                const y0 = Math.round(r.top + r.height / 2);
                const mk = (type, y, buttons) =>
                    new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        pointerType: 'touch',
                        pointerId: 31,
                        isPrimary: true,
                        button: type === 'pointerdown' ? 0 : -1,
                        buttons,
                        clientX: x,
                        clientY: y,
                    });
                el.dispatchEvent(mk('pointerdown', y0, 1));
                await wait(60);
                const steps = 10;
                for (let i = 1; i <= steps; i++) {
                    window.dispatchEvent(mk('pointermove', Math.round(y0 + (delta * i) / steps), 1));
                    await wait(35);
                }
                window.dispatchEvent(mk('pointerup', Math.round(y0 + delta), 0));
                await wait(600);
                return 'ok';
            },
            sel,
            dy,
        );
        const after = await state();
        return { ok, before, after };
    };

    const s0 = await ensureSplit();
    console.log('▸ 初始分屏：' + JSON.stringify(s0));
    check(
        'C6-前置 分屏就位（两块 + 参数拍数栏手柄在位）',
        s0.kids.length >= 2 && s0.handles.includes('paramsRuler'),
        `kids=${JSON.stringify(s0.kids)}；handles=${JSON.stringify(s0.handles)}`,
    );

    {
        const r = await dragHandle('[data-hs-time-ruler="params"]', -60);
        const h0 = r.before.kids[0] ? r.before.kids[0].h : 0;
        const h1 = r.after.kids[0] ? r.after.kids[0].h : 0;
        check(
            'C6-a 上拖参数拍数栏 ⇒ 分界线上移（轨道变矮，两块都在）',
            r.ok === 'ok' && r.after.timeline && r.after.params && h1 < h0 - 15,
            `轨道块高 ${h0} → ${h1}；timeline=${r.after.timeline} params=${r.after.params}；kids=${JSON.stringify(r.after.kids)}`,
        );
    }

    {
        await ensureSplit();
        const r = await dragHandle('[data-hs-time-ruler="params"]', 80);
        const h0 = r.before.kids[1] ? r.before.kids[1].h : 0;
        const h1 = r.after.kids[1] ? r.after.kids[1].h : 0;
        check(
            'C6-b 下拖参数拍数栏 ⇒ 分界线下移（参数面板变矮，两块都在）',
            r.ok === 'ok' && r.after.timeline && r.after.params && h1 < h0 - 15,
            `参数块高 ${h0} → ${h1}；timeline=${r.after.timeline} params=${r.after.params}；kids=${JSON.stringify(r.after.kids)}`,
        );
    }

    {
        await ensureSplit();
        const r = await dragHandle('[data-hs-time-ruler="params"]', -420);
        check(
            'C6-c 上拖到很接近顶部 ⇒ 轨道过小**自动关闭**（回参数全屏）',
            r.ok === 'ok' && r.after.timeline === false && r.after.params === true,
            `timeline=${r.after.timeline}；params=${r.after.params}；kids=${JSON.stringify(r.after.kids)}`,
        );
    }

    {
        const pre = await state();
        const r = await dragHandle('[data-hs-time-ruler="params"]', 200);
        check(
            'C5-a 全屏非轨道界面**下拉进分屏**（轨道被拉出来）',
            r.ok === 'ok' &&
                pre.timeline === false &&
                r.after.timeline === true &&
                r.after.params === true,
            `拖动前 timeline=${pre.timeline}；拖动后 timeline=${r.after.timeline} params=${r.after.params}；kids=${JSON.stringify(r.after.kids)}`,
        );
    }

    {
        await ensureSplit();
        const r = await dragHandle('[data-hs-time-ruler="params"]', 420);
        check(
            'C5-b 下拖到很接近底部 ⇒ 非轨道面板**全部关闭**（回全屏轨道）',
            r.ok === 'ok' && r.after.timeline === true && r.after.params === false,
            `timeline=${r.after.timeline}；params=${r.after.params}；kids=${JSON.stringify(r.after.kids)}`,
        );
    }

    {
        await clickMenuItem('文件管理');
        const withFiles = await state();
        const hasFilesHandle = withFiles.handles.includes('files');
        await clickMenuItem('记事本');
        const withNotes = await state();
        const hasNotesHandle = withNotes.handles.includes('notes');
        check(
            'C6-d 文件管理标题栏 / 记事本标题栏也挂了拖拽手柄',
            hasFilesHandle && hasNotesHandle,
            `文件=${hasFilesHandle}；记事本=${hasNotesHandle}（实测 handles=${JSON.stringify(withNotes.handles)}）`,
        );
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
