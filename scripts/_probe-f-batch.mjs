#!/usr/bin/env node
/**
 * F 组验收：F1（浮条「更多」⇒ 右键菜单）/ F2（^ 菜单两项改名）/
 *          F3（工程设置六项修正）/ F4（浮层高度自适应）。
 *
 * 说明：F1 的完整链路（点浮条「更多」→ 出现 ClipContextMenu）依赖浮条本身可见，
 * 而浮条在"块足够窄且在可视区内"时才渲染（见 E6 的记录）。这里改为**直接派发**
 * 浮条所用的同一个事件（`hs-open-clip-context-menu`）来验证"事件 → 菜单"这一段，
 * 前提是先把某个块设为选中（后端 `select_clip` / 前端点块）。
 *
 * 用法：node scripts\_probe-f-batch.mjs [serial]
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
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const tap = async (x, y) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
    };
    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ── F3 + F4：打开工程设置浮层并量测 ──────────────────────────
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent('hs-open-settings', { detail: { which: 'project' } }));
    });
    await sleep(1500);
    const f3 = await cdp.call(() => {
        const el = document.querySelector('[data-hs-project-settings]');
        if (!el) return { open: false };
        const r = el.getBoundingClientRect();
        const txt = (el.innerText || '').replace(/\s+/g, ' ');
        const scaleGroup = document.querySelector('[data-hs-project-base-scale-group]');
        const gridInput = document.querySelector('[data-hs-project-grid-input]');
        const pathVal = [...el.querySelectorAll('span,div')]
            .map((x) => x.textContent || '')
            .find((s) => s.includes('未保存')) ?? '';
        return {
            open: true,
            height: Math.round(r.height),
            vh: window.innerHeight,
            hasDescSentence: /工程级设置（与全局外观设置分开）/.test(txt),
            baseScaleButtons: scaleGroup ? scaleGroup.querySelectorAll('button').length : 0,
            gridInput: Boolean(gridInput),
            gridPresets: [...el.querySelectorAll('button')].filter((b) => /^\d+\/\d+$/.test((b.textContent || '').trim())).length,
            unsavedShort: txt.includes('（未保存）'),
            unsavedLong: /未保存：/.test(txt),
            head: txt.slice(0, 120),
        };
    });
    console.log('▸ 工程设置浮层：' + JSON.stringify(f3));
    check(
        'F3-a 基准音阶可调（按钮组，12 个音阶）',
        f3.open && f3.baseScaleButtons >= 12,
        `base scale 按钮数 = ${f3.baseScaleButtons}`,
    );
    check(
        'F3-b/c 上方不再赘述网格/拍数，且说明句已删除',
        f3.open && f3.hasDescSentence === false,
        `含说明句=${f3.hasDescSentence}；文本头部="${f3.head}"`,
    );
    check(
        'F3-e 「（未保存）」已简化（不再带长句）',
        f3.open && f3.unsavedShort === true && f3.unsavedLong === false,
        `短=(${f3.unsavedShort}) 长=(${f3.unsavedLong})`,
    );
    check(
        'F3-f 网格有预设按钮**且有手动输入框**',
        f3.open && f3.gridPresets >= 6 && f3.gridInput === true,
        `预设按钮 ${f3.gridPresets} 个；输入框=${f3.gridInput}`,
    );
    check(
        'F4 浮层高度按内容自适应（明显小于视口）',
        f3.open && f3.height > 80 && f3.height < f3.vh - 40,
        `浮层高 ${f3.height}px / 视口 ${f3.vh}px`,
    );
    // 关掉
    await cdp.call(() => {
        document.querySelector('[data-hs-project-backdrop]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(800);

    // ── F2：^ 菜单两项改名（…）───────────────────────────────────
    const f2 = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // 打开 ^ 浮层：底栏上带 aria-expanded 的"更多开关"
        const trig = [...document.querySelectorAll('button')].find(
            (b) => (b.getAttribute('data-tooltip') || b.ariaLabel || '') === '更多开关',
        );
        if (trig) {
            trig.click();
            await wait(1200);
        }
        const labels = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
        return {
            hasGridEllipsis: labels.some((s) => s.startsWith('吸附网格') && s.endsWith('…')),
            hasSplitEllipsis: labels.some((s) => s.startsWith('分割过渡') && s.endsWith('…')),
            samples: labels.filter((s) => s.length > 1 && s.length < 12).slice(0, 14),
        };
    });
    console.log('▸ ^ 菜单：' + JSON.stringify(f2));
    check(
        'F2 「分割过渡…」「吸附网格…」命名带省略号',
        f2.hasGridEllipsis && f2.hasSplitEllipsis,
        JSON.stringify(f2.samples),
    );

    // ── F1：派发事件 ⇒ 出现右键那套菜单 ───────────────────────────
    /* F1 前先切到**轨道面板**：`TimelinePanel` 只在它可见时挂载 ⇒ 事件监听也只在那时存在。 */
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent("hs-mobile-switch-tab", { detail: { tab: "timeline" } }));
    });
    await sleep(2000);    const f1 = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        let st = await inv('get_timeline_state', {});
        if (!(st.clips || []).length) {
            await inv('import_audio_item', {
                audioPath: '/sdcard/Download/test-rr.wav',
                trackId: null,
                startSec: 0,
                mediaAudioStreamIndex: null,
            });
            await wait(2600);
            st = await inv('get_timeline_state', {});
        }
        const clip = (st.clips || [])[0];
        if (!clip) return { why: 'no-clip' };
        // 先选中该块（用后端命令，避免依赖 DOM 命中）
        await inv('select_clip', { clipId: clip.id }).catch(() => null);
        await wait(600);
        window.dispatchEvent(new CustomEvent('hs-open-clip-context-menu', { detail: { x: 120, y: 240 } }));
        await wait(1200);
        const menus = [...document.querySelectorAll('[role=menu],div')].filter((el) => {
            const t = el.innerText || '';
            return /重命名|删除|静音|规范化|反转/.test(t) && el.getBoundingClientRect().height > 60;
        });
        return { menus: menus.length, sample: menus[0] ? (menus[0].innerText || '').replace(/\s+/g, ' ').slice(0, 90) : null };
    });
    console.log('▸ F1：' + JSON.stringify(f1));
    check(
        'F1 事件能唤起右键那套菜单（含重命名/删除/静音等项）',
        f1.menus > 0,
        JSON.stringify(f1),
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
