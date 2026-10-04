#!/usr/bin/env node
/**
 * #7 验收：**音频块右键菜单在"矮视口"（横屏）下必须完整可见**
 *
 * 用户口径（2026-10-04）：「长按音频块弹出的那个菜单（含 M/S、合成轨、算法等项）
 *   **只在横屏下显示不完整**，竖屏正常」。
 *
 * 根因：`components/layout/timeline/ClipContextMenu.tsx` 的视口夹取原来只有
 *   `if (rect.bottom > vh) el.style.top = Math.max(0, vh - rect.height)` —— 横屏 `vh≈360`
 *   而菜单自然高约 400px ⇒ 算出 `top=0` 但**仍旧高出屏幕**，且没有 max-height / 滚动兜底
 *   ⇒ 底部几项永远点不到。修法：先给 `maxHeight = vh − 8` + `overflowY:auto`，**再**夹位置。
 *
 * 本判据**用 CDP 视口覆盖模拟"矮视口"**（752×360），不动设备的自动旋转设置
 *   —— 避免上一次那个"探针把用户手机的自动旋转关掉"的副作用。
 *
 * 用法：node scripts/_probe-e41-clipmenu-landscape.mjs [--serial 221deeb]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
let wav = 'D:\\Temp\\hs-tone.wav';
/** `--vh 752x360`：**启动前**就把视口覆盖成矮视口（= "菜单是在横屏下打开的"这个真实场景）。 */
let vh = null;
for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--serial') serial = argv[++i];
    else if (argv[i] === '--wav') wav = argv[++i];
    else if (argv[i] === '--vh') vh = argv[++i];
}

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
if (!pid) throw new Error('应用没在跑');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

/* 🔴 关键：视口覆盖必须在**打开菜单之前**生效，否则菜单是在旧视口下挂载的，
   `useLayoutEffect([x,y])` 不会因视口变化重跑 ⇒ `max-height` 停在旧值（第一版探针就这么误判了）。 */
if (vh) {
    const [w, h] = vh.split('x').map(Number);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 2,
        mobile: true,
    });
    await sleep(1200);
}

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

/* 清空工程 + 导入一个块（走面板自己的编辑通道）。 */
await cdp.call(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.ariaLabel === '停止');
    if (b) b.click();
});
await sleep(500);
for (let i = 0; i < 5; i++) {
    const n = await cdp.call(() => window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => s.clips.length));
    if (n === 0) break;
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(800);
}
await cdp.call((b) => window.__hsImportAudioBase64('menu.wav', b, 0.5), readFileSync(wav).toString('base64'));
await sleep(1600);

/** 在块中部派发 contextmenu（= Android 长按块的等价路径，内核 `handleKernelContextMenu` 收）。 */
const openMenu = () =>
    cdp.call(() =>
        window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
            const vp = window.__hsViewport();
            const c = vp.containerRect;
            const clip = (s.clips || [])[0];
            if (!clip) return null;
            const x = Math.round(c.left + (clip.start_sec + clip.length_sec / 2) * vp.pxPerSec - vp.scrollLeft);
            const rowEl = document.querySelector(`[data-hs-track-row="${clip.track_id}"]`);
            const rr = rowEl ? rowEl.getBoundingClientRect() : null;
            const y = Math.round((rr ? rr.top + rr.height : c.top + 40) * 0.5 + (rr ? rr.top + rr.height * 0.6 : c.top + 40) * 0.5);
            const el = document.elementFromPoint(x, y) ?? document.body;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            return { x, y };
        }),
    );

const readMenu = () =>
    cdp.call(() => {
        const el = document.querySelector('[data-hs-context-menu="1"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            count: document.querySelectorAll('[data-hs-context-menu="1"]').length,
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            height: Math.round(r.height),
            innerMaxH: el.style.maxHeight || null,
            computedMaxH: cs.maxHeight,
            overflowY: cs.overflowY,
            clientH: el.clientHeight,
            scrollH: el.scrollHeight,
            vh: window.innerHeight,
            vw: window.innerWidth,
        };
    });

/* ── 竖屏基线（不带 `--vh` 时跑；带 `--vh` 时这一相无意义）──────────────── */
if (!vh) {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await sleep(600);
    await openMenu();
    await sleep(700);
    const portrait = await readMenu();
    check(
        'N0 竖屏基线：右键菜单能打开且底边不出屏',
        portrait !== null && portrait.bottom <= portrait.vh + 1,
        JSON.stringify(portrait),
    );
}

/* ── 矮视口（横屏 752×360）⇒ 菜单必须被 maxHeight 夹住 + 可滚动 ────── */
await openMenu();
await sleep(800);
const land = await readMenu();
check(
    'L1 矮视口（横屏 752×360）下菜单**底边不出屏**（修复前 top=0 仍高出屏幕）',
    land !== null && land.bottom <= land.vh + 1 && land.top >= -1,
    JSON.stringify(land),
);
check(
    'L2 菜单带 `max-height`（= 视口高 − 8） + 内部滚动兜底',
    land !== null &&
        land.innerMaxH === `${Math.max(80, Math.round(land.vh - 8))}px` &&
        land.overflowY === 'auto',
    `inline maxHeight=${land?.innerMaxH}（期望 ${land ? Math.max(80, Math.round(land.vh - 8)) : '?'}px = vh−8） overflowY=${land?.overflowY}`,
);
check(
    'L3 菜单高度**不超过视口**（否则底部几项永远点不到）',
    land !== null && land.height <= land.vh - 4,
    `height=${land?.height} vh=${land?.vh} scrollH=${land?.scrollH} clientH=${land?.clientH}`,
);

/* ── 收尾：清掉视口覆盖 ─────────────────────────────────────────────── */
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await sleep(800);
const back = await cdp.call(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
check('N9 收尾：视口覆盖已清除（恢复真实视口）', back.vw !== 752 || back.vh !== 360, JSON.stringify(back));

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== #7 右键菜单矮视口探针：通过 ${pass} / ${results.length} ===`);
for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
