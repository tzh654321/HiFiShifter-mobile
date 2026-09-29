#!/usr/bin/env node
/**
 * E1 / E21 验收（**纯净版**，不碰任何会切走前台的动作）。
 *
 * ⚠️ 教训（写在这里防止再犯）：上一版探针在 E21 分支里调用了 `pickDirectory()`（SAF 目录选择器）
 *    和 `openAllFilesAccessSettings()`（系统设置页）—— 这两个都会**把应用切到后台**，
 *    于是 WebView 暂停、`Runtime.evaluate` 全部超时，被误判成"点开对话框导致页面卡死"。
 *    本脚本只做**应用内**的操作：打开菜单 → 点条目 → 读 DOM / 读后端。
 *
 * 判据：
 *   E1-a 文件菜单里有「工程设置…」；
 *   E1-b 点开后出现工程设置浮层（`[data-hs-project-settings]`），字段齐全；
 *   E1-c 网格按钮点击后后端 `project.grid_size` 变化；
 *   E21-a 选项菜单里有「存储设置…」；
 *   E21-b 点开后出现存储设置浮层（`[data-hs-storage-settings]`），显示实际生效目录与三种授权；
 *   E21-c 后端 `storage_settings_state` 报出的生效目录 = /storage/emulated/0/HiFiShifter。
 *
 * 用法：node scripts\_probe-e1-e21-clean.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const DEFAULT_ROOT = '/storage/emulated/0/HiFiShifter';

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
    const inv = (c, a) =>
        cdp.call(
            (cmd, args) =>
                window.__TAURI_INTERNALS__.invoke(cmd, args).catch((e) => ({ err: String(e).slice(0, 140) })),
            c,
            a,
        );
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

    /** 打开某个顶层菜单，返回其菜单项文本（用真触摸）。 */
    const openMenu = async (label) => {
        const box = await cdp.call((lb) => {
            const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === lb);
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, label);
        if (!box) return [];
        await tap(box.x, box.y);
        return cdp.call(() =>
            [...document.querySelectorAll('[role=menuitem],button,div')]
                .map((x) => (x.textContent || '').trim())
                .filter((s) => s && s.length <= 10),
        );
    };
    /** 点菜单项（在已打开的菜单里按文本前缀找）。 */
    const pick = async (prefix) => {
        const box = await cdp.call((pfx) => {
            const el = [...document.querySelectorAll('[role=menuitem],button,div')].find(
                (x) => (x.textContent || '').trim().startsWith(pfx) && x.getBoundingClientRect().height < 60,
            );
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, prefix);
        if (!box) return false;
        await tap(box.x, box.y);
        await sleep(1200);
        return true;
    };
    const closeOverlay = () =>
        cdp.call(() => {
            const backdrops = document.querySelectorAll(
                '[data-hs-project-backdrop],[data-hs-storage-backdrop]',
            );
            const b = backdrops[0];
            if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return backdrops.length;
        });

    // ── 后端报告 ─────────────────────────────────────────────────
    const rep = await inv('storage_settings_state', {});
    console.log('▸ 存储报告：' + JSON.stringify(rep));
    check(
        'E21-c 实际生效目录 = /storage/emulated/0/HiFiShifter',
        String(rep?.effectiveRoot || '') === DEFAULT_ROOT,
        `effectiveRoot=${rep?.effectiveRoot}（fallback=${rep?.fallbackRoot}）`,
    );

    // ── E1 ───────────────────────────────────────────────────────
    const fileItems = await openMenu('文件');
    console.log('▸ 文件菜单项：' + JSON.stringify(fileItems.slice(0, 6)));
    check(
        'E1-a 文件菜单里有「工程设置…」',
        fileItems.some((s) => s.startsWith('工程设置')),
        JSON.stringify(fileItems.slice(0, 4)),
    );
    await pick('工程设置');
    const proj = await cdp.call(() => {
        const el = document.querySelector('[data-hs-project-settings]');
        const txt = el ? (el.innerText || '').replace(/\s+/g, ' ') : '';
        return {
            open: Boolean(el),
            hasName: /工程名/.test(txt),
            hasGrid: /网格/.test(txt),
            hasUndo: /撤销历史/.test(txt),
            hasPath: /工程路径/.test(txt),
            head: txt.slice(0, 110),
        };
    });
    console.log('▸ 工程设置浮层：' + JSON.stringify(proj));
    check(
        'E1-b 工程设置浮层打开且字段齐全（工程名/路径/网格/撤销历史）',
        proj.open && proj.hasName && proj.hasPath && proj.hasGrid && proj.hasUndo,
        proj.head,
    );
    // E1-c 网格改动落到后端
    const gridBefore = String((await inv('get_timeline_state', {})).project?.grid_size ?? '');
    const gridBtn = await cdp.call(() => {
        const el = document.querySelector('[data-hs-project-settings]');
        if (!el) return null;
        const btns = [...el.querySelectorAll('button')].filter((b) => /^1\/\d+$/.test((b.textContent || '').trim()));
        const target = btns.find((b) => (b.textContent || '').trim() !== '1/4') ?? btns[1];
        if (!target) return null;
        const r = target.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), value: (target.textContent || '').trim() };
    });
    if (gridBtn) {
        await tap(gridBtn.x, gridBtn.y);
        await sleep(1200);
    }
    const gridAfter = String((await inv('get_timeline_state', {})).project?.grid_size ?? '');
    check(
        'E1-c 网格按钮点击后后端 grid_size 变化',
        Boolean(gridBtn) && gridAfter === gridBtn.value,
        `${gridBefore} → ${gridAfter}（点了 ${gridBtn?.value}）`,
    );
    if (gridBefore) {
        await inv('set_project_timeline_settings', {
            beatsPerBar: 4,
            timeSignatureDenominator: 4,
            gridSize: gridBefore,
        });
    }
    await closeOverlay();
    await sleep(600);

    // ── E21 ──────────────────────────────────────────────────────
    const optItems = await openMenu('选项');
    console.log('▸ 选项菜单项：' + JSON.stringify(optItems.slice(0, 6)));
    check(
        'E21-a 选项菜单里有「存储设置…」',
        optItems.some((s) => s.startsWith('存储设置')),
        JSON.stringify(optItems.slice(0, 4)),
    );
    await pick('存储设置');
    const stor = await cdp.call(() => {
        const el = document.querySelector('[data-hs-storage-settings]');
        const txt = el ? (el.innerText || '').replace(/\s+/g, ' ') : '';
        return {
            open: Boolean(el),
            effective: document.querySelector('[data-hs-storage-effective]')?.textContent?.trim() ?? null,
            hasAllFiles: /所有文件访问/.test(txt),
            hasSaf: /SAF/.test(txt),
            hasShizuku: /Shizuku/.test(txt),
            head: txt.slice(0, 140),
        };
    });
    console.log('▸ 存储设置浮层：' + JSON.stringify(stor));
    check(
        'E21-b 存储设置浮层打开，显示生效目录与三种授权',
        stor.open && stor.effective === DEFAULT_ROOT && stor.hasAllFiles && stor.hasSaf && stor.hasShizuku,
        stor.head,
    );
    await closeOverlay();

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
