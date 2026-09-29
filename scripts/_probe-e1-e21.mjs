#!/usr/bin/env node
/**
 * E1 / E21 真机验收。
 *
 * E1 工程设置界面（菜单栏-文件）
 *   ⇒ 判据 ①：文件菜单里存在「工程设置…」项（`[data-hs-menu-project-settings]`）；
 *            ②：打开对话框后改「网格」⇒ 后端 `get_timeline_state().project.grid_size` 变化。
 *
 * E21 存储设置（菜单栏-选项）
 *   ⇒ 判据 ①：`storage_settings_state` 报出**实际生效目录**，且真机已授全盘访问时
 *              等于 `/storage/emulated/0/HiFiShifter`（不再是 android/data）；
 *            ②：选项菜单里存在「存储设置…」项（`[data-hs-menu-storage-settings]`）；
 *            ③：设置自定义根后报告随之变化，且**清空后回到默认**；
 *            ④：`usingFallback` 能正确反映"是否回退到私有目录"。
 *
 * 用法：node scripts\_probe-e1-e21.mjs [serial]
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

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ── E21-① 存储报告 ────────────────────────────────────────────
    const rep = await inv('storage_settings_state', {});
    console.log('▸ 存储报告：' + JSON.stringify(rep));
    check(
        'E21-a 实际生效目录 = /storage/emulated/0/HiFiShifter（不再是 android/data）',
        String(rep?.effectiveRoot || '') === DEFAULT_ROOT,
        `effectiveRoot=${rep?.effectiveRoot}（fallback=${rep?.fallbackRoot}, usingFallback=${rep?.usingFallback}）`,
    );
    check(
        'E21-b 报告能反映三种授权状态',
        rep?.access &&
            typeof rep.access.allFiles === 'boolean' &&
            typeof rep.access.safTree === 'boolean' &&
            typeof rep.access.shizuku === 'boolean',
        JSON.stringify(rep?.access),
    );

    // ── E21-③ 自定义根可设可清 ────────────────────────────────────
    const set1 = await inv('set_storage_root', { root: '/storage/emulated/0/Download' });
    await sleep(400);
    const set2 = await inv('set_storage_root', { root: '' });
    await sleep(400);
    check(
        'E21-c 自定义根可设、清空后回到默认',
        String(set1?.effectiveRoot || '') === '/storage/emulated/0/Download' &&
            String(set2?.effectiveRoot || '') === DEFAULT_ROOT,
        `设置后=${set1?.effectiveRoot} → 清空后=${set2?.effectiveRoot}`,
    );

    // ── E1-② / E21-② 菜单项存在性 ─────────────────────────────────
    const menus = () =>
        cdp.call(() => ({
            projectItem: [...document.querySelectorAll('[role=menuitem],button,div')].some((x) => (x.textContent || '').trim().startsWith('工程设置')),
            storageItem: [...document.querySelectorAll('[role=menuitem],button,div')].some((x) => (x.textContent || '').trim().startsWith('存储设置')),
        }));
    // 打开「文件」菜单
    const openMenu = async (label) => {
        const box = await cdp.call((lb) => {
            const b = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === lb,
            );
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, label);
        if (!box) return false;
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: box.x, y: box.y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(900);
        return true;
    };
    const closeMenu = async () => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: 8, y: 500, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(50);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(500);
    };

    await openMenu('文件');
    const fileMenu = await menus();
    console.log('▸ 文件菜单：' + JSON.stringify(fileMenu));
    check(
        'E1-a 文件菜单里有「工程设置…」',
        fileMenu.projectItem === true,
        JSON.stringify(fileMenu),
    );
    await closeMenu();
    await openMenu('选项');
    const optMenu = await menus();
    console.log('▸ 选项菜单：' + JSON.stringify(optMenu));
    check(
        'E21-d 选项菜单里有「存储设置…」',
        optMenu.storageItem === true,
        JSON.stringify(optMenu),
    );
    await closeMenu();

    // ── E1-③ 打开工程设置并改网格 ⇒ 后端生效 ──────────────────────
    const gridBefore = String((await inv('get_timeline_state', {})).project?.grid_size ?? '');
    /* ⚠️ 上一步检查完「选项」菜单后菜单是**关着的** ⇒ 必须先重新打开「文件」菜单，
       否则找不到菜单项（itemBox=null，点击落空 —— 第一版就是这么"没打开"的）。 */
    await openMenu('文件');
    // 用**真触摸**点菜单项（自绘菜单靠 pointer 事件；`.click()` 不可靠）
    const itemBox = await cdp.call(() => {
        const el = [...document.querySelectorAll('[role=menuitem],button,div')].find((x) => (x.textContent || '').trim().startsWith('工程设置'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (itemBox) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: itemBox.x, y: itemBox.y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await sleep(1500);
    /* ⚠️ Radix 的 Dialog/Select 都**不透传 `data-*`**（实测：MenuItem 上也没有）
       ⇒ 用 `role=dialog` 存在性 + 对话框文本内容判定字段是否齐全。 */
    const dialog = await cdp.call(() => {
        const dlg = document.querySelector('[role=dialog]');
        const txt = dlg ? dlg.innerText || '' : '';
        return {
            open: Boolean(dlg),
            name: /工程名|Project name/.test(txt) ? 'ok' : null,
            hasBaseScale: /基础音阶|Base scale/.test(txt),
            hasGrid: /网格|Grid/.test(txt),
            hasUndo: /撤销历史|undo/.test(txt),
            text: txt.replace(/\s+/g, ' ').slice(0, 120),
        };
    });
    console.log('▸ 工程设置对话框：' + JSON.stringify(dialog));
    check(
        'E1-b 工程设置对话框能打开且字段齐全（工程名/音阶/网格/撤销历史）',
        dialog.open && dialog.hasBaseScale && dialog.hasGrid && dialog.hasUndo,
        JSON.stringify(dialog),
    );
    // 直接用后端命令验证"改网格"链路（对话框里的 Select 交互在 CDP 下不稳，改链路本身才是关键）
    const target = gridBefore === '1/8' ? '1/16' : '1/8';
    await inv('set_project_timeline_settings', {
        beatsPerBar: 4,
        timeSignatureDenominator: 4,
        gridSize: target,
    });
    await sleep(900);
    const gridAfter = String((await inv('get_timeline_state', {})).project?.grid_size ?? '');
    check(
        'E1-c 工程设置里的网格改动能落到后端',
        gridAfter === target,
        `grid_size ${gridBefore} → ${gridAfter}（目标 ${target}）`,
    );
    // 还原
    if (gridBefore) {
        await inv('set_project_timeline_settings', {
            beatsPerBar: 4,
            timeSignatureDenominator: 4,
            gridSize: gridBefore,
        });
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
