#!/usr/bin/env node
/**
 * E37 判据 —— **轨道头长按菜单的时机**（用户 2026-10-03 两条口径）：
 *
 *   ① 「长按**未选中**的轨道时应该**松手时**再弹出菜单，不然拖动不了顺序了」
 *      —— 修前：按住未选中的轨道，`onPointerDownCapture` 立刻 dispatch 选中
 *      ⇒ 列表重渲 ⇒ `tracks` 换引用 ⇒ 原生 touch 的 effect **重订阅**
 *      （cleanup 里的 `reset()` 清空长按候选）⇒ 这次手势拦不住原生 `contextmenu`
 *      （Android 约 500ms 自己派发）⇒ 菜单**在按住期间**就弹出来，排序也做不了。
 *
 *   ② 「长按**已选中**轨道的轨道头**打不开菜单**」
 *      —— 修前：长按不动时真机仍持续产生 `touchmove`（1~3px 抖动），
 *      而代码"任何 touchmove 就置 `moved = true`"⇒ 松手补发菜单的条件永不成立。
 *
 * 判据（都在**按住期间**与**抬手之后**两个时刻分别取样）：
 *   E37-A 未选中轨道：按住 700ms **期间**不得出现轨道菜单
 *   E37-B 同一次长按：**抬手后**菜单必须出现
 *   E37-C 已选中轨道：按住 700ms 期间同样不得出现
 *   E37-D 已选中轨道：抬手后菜单必须出现
 *   E37-E 回归：长按后**划动** ⇒ 顺序真的变了，且**全程不弹菜单**（A2：不同时生效两条）
 *
 * 用法：node scripts/_probe-e37-longpress-menu.mjs [serial]
 * 前置：至少 2 条轨道（本探针会沿用现有工程；只有 1 条时 E37-A/B/E 标"不可判"）。
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
if (!pid) {
    console.error('🔴 app 未运行');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 6,
            radiusY: 6,
            force: 1,
        })),
    });

const results = [];
const skipped = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};
const skip = (name, why) => {
    skipped.push(name);
    console.log(`⬜ ${name}\n     不可判：${why}`);
};

/**
 * 轨道行的几何。**选中态从 `window.__hsSelection()` 读**（`App.tsx` 的只读验收钩子，
 * 返回 `{ clipId, trackId, multi }`）—— DOM 上"哪一行是选中态"只有背景色差异、读不到；
 * 走钩子还能免掉"为探针加属性 ⇒ 必须重新构建"的代价。
 */
const readRows = () =>
    cdp.call(() => {
        let selTrackId = null;
        try {
            const s = window.__hsSelection ? window.__hsSelection() : null;
            selTrackId = s?.trackId ?? null;
        } catch {
            selTrackId = null;
        }
        const out = [];
        for (const el of document.querySelectorAll('[data-hs-track-row]')) {
            const r = el.getBoundingClientRect();
            if (r.height < 8) continue;
            const id = el.getAttribute('data-hs-track-row');
            out.push({
                id,
                selected: id !== null && id === selTrackId,
                left: Math.round(r.left),
                top: Math.round(r.top),
                w: Math.round(r.width),
                h: Math.round(r.height),
            });
        }
        return out;
    });

const menuOpen = () => cdp.call(() => Boolean(document.querySelector('[data-track-ctx-menu]')));

/** 长按一次（期间在 `holdMs` 时刻取样一次菜单），返回三个读数。 */
async function longPress(row, { holdMs = 700, moveDy = 0 } = {}) {
    const x = row.left + 62; // 与 E33 探针同一处（落在轨道头文字区，避开 C/M/S 与色点）
    const y = Math.round(row.top + row.h / 2);
    await touch('touchStart', [{ x, y }]);
    await sleep(holdMs);
    const menuDuringHold = await menuOpen();
    if (moveDy !== 0) {
        const steps = 6;
        for (let i = 1; i <= steps; i++) {
            await touch('touchMove', [{ x, y: Math.round(y + (moveDy * i) / steps) }]);
            await sleep(45);
        }
        await sleep(120);
    }
    const menuBeforeRelease = await menuOpen();
    await touch('touchEnd', []);
    await sleep(900);
    const menuAfterRelease = await menuOpen();
    return { menuDuringHold, menuBeforeRelease, menuAfterRelease, x, y };
}

/** 关掉可能还开着的菜单：点底栏上方那条空白（菜单自己监听"点别处关闭"）。 */
async function dismissMenu() {
    if (!(await menuOpen())) return true;
    const p = await cdp.call(() => {
        const h = window.innerHeight;
        return { x: Math.round(window.innerWidth - 24), y: Math.round(h - 26) };
    });
    await touch('touchStart', [p]);
    await touch('touchEnd', []);
    await sleep(500);
    return !(await menuOpen());
}

let rows = await readRows();
console.log(`▸ 轨道行：${rows.map((r) => `${r.id}${r.selected ? '(选中)' : ''}`).join(' · ')}`);
if (rows.length === 0) {
    console.error('🔴 读不到任何轨道行');
    cdp.close();
    process.exit(1);
}

/* ── A/B：未选中轨道 ─────────────────────────────────────────────────── */
const unsel = rows.find((r) => !r.selected);
if (unsel === undefined) {
    skip('E37-A 未选中轨道：长按期间**不弹**菜单', '当前只有 1 条（已选中）轨道，没有"未选中"的行');
    skip('E37-B 未选中轨道：**抬手后**弹出菜单', '同上');
} else {
    const r = await longPress(unsel);
    check(
        'E37-A 未选中轨道：长按 700ms **期间**不弹菜单（否则这次手势没法拿去排序）',
        r.menuDuringHold === false,
        `按住 ${700}ms 时 menu=${r.menuDuringHold}（起手 x=${r.x} y=${r.y}）`,
    );
    check(
        'E37-B 未选中轨道：同一次长按**抬手后**菜单出现',
        r.menuAfterRelease === true,
        `抬手后 menu=${r.menuAfterRelease}`,
    );
    const dismissed = await dismissMenu();
    if (!dismissed) console.log('⚠️ 菜单没能关掉（后续判据可能受污染）');
}

/* ── C/D：已选中轨道 ─────────────────────────────────────────────────── */
rows = await readRows();
const sel = rows.find((r) => r.selected) ?? rows[0];
{
    const r = await longPress(sel);
    check(
        'E37-C 已选中轨道：长按 700ms 期间不弹菜单',
        r.menuDuringHold === false,
        `按住 ${700}ms 时 menu=${r.menuDuringHold}（起手 x=${r.x} y=${r.y}）`,
    );
    check(
        'E37-D 已选中轨道：**抬手后**菜单出现（修前恒缺席）',
        r.menuAfterRelease === true,
        `抬手后 menu=${r.menuAfterRelease}`,
    );
    await dismissMenu();
}

/* ── E：长按后划动 ⇒ 只排序、不弹菜单 ───────────────────────────────── */
rows = await readRows();
if (rows.length < 2) {
    skip('E37-E 长按后划动 ⇒ 顺序变、全程不弹菜单', '需要 ≥2 条轨道');
} else {
    const from = rows.find((r) => !r.selected) ?? rows[0];
    const orderBefore = rows.map((r) => r.id);
    const step = from.h + 4;
    const r = await longPress(from, { moveDy: step });
    const orderAfter = (await readRows()).map((x) => x.id);
    check(
        'E37-E 长按后**划动** ⇒ 顺序真的变了，且**全程不弹菜单**（A2）',
        r.menuDuringHold === false && r.menuBeforeRelease === false && JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
        `before=${JSON.stringify(orderBefore)} after=${JSON.stringify(orderAfter)} menu(按住中)=${r.menuDuringHold} menu(抬手前)=${r.menuBeforeRelease}`,
    );
    await dismissMenu();
}

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== E37 长按菜单时机：通过 ${pass} / ${results.length}（另有 ${skipped.length} 条不可判）===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
for (const n of skipped) console.log(`⬜ ${n}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
