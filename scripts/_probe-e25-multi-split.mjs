/**
 * E25 多窗口分屏「分别调高」判据（2026-10-02，用户口径）——
 *
 * > 「三、四个窗口分屏时无法**分别**调节分屏高度」
 *
 * 实现（`App.tsx`）：下方块的三块（参数/文件/记事本）各有一个**权重**
 * （`hifishifter.mobileLowerWeights`，默认 1 = 与旧的"均分"完全一致），
 * 每块**自己的顶部标题条**就是它上面那条分界线的可拖手柄：
 *   · 第一块可见的下方面板（通常是参数）⇒ 调的仍是"轨道块 vs 下方块"（老路径）；
 *   · 其余（文件 / 记事本）⇒ 调**它与其上一块**这一对（两块权重之和守恒）。
 *
 * 判据（4 块同屏时逐个拖）：
 *   A 四块同屏后，各块高度可读；
 *   B 拖「文件」标题条 ⇒ **文件↑ 参数↓**，而**轨道块与记事本不变**（只动相邻那一对）；
 *   C 拖「记事本」标题条 ⇒ **记事本↑ 文件↓**，参数与轨道块不变；
 *   D 权重写进了 localStorage（下次启动保持）。
 *
 * 用法：node scripts/_probe-e25-multi-split.mjs <serial>
 */
import { Cdp } from './lib/cdp.mjs';
import { execSync } from 'node:child_process';

const serial = process.argv[2] ?? process.env.ANDROID_SERIAL ?? 'emulator-5554';
const PKG = 'com.arounder.hifishifter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args) => execSync(`adb -s ${serial} ${args}`, { encoding: 'utf8' }).replace(/\r/g, '');

const pid = adb(`shell pidof ${PKG}`).trim();
if (!pid) {
    console.log('🔴 应用没在跑');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}`);
    if (detail !== undefined) console.log(`     ${detail}`);
    if (ok) pass += 1;
    else fail += 1;
};

const openPane = (tab) =>
    cdp.call((w) => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: w } }));
        return true;
    }, tab);

const heights = () =>
    cdp.call(() => {
        const out = {};
        for (const k of ['timeline', 'params', 'files', 'notes']) {
            const el = document.querySelector(`[data-hs-pane="${k}"]`);
            out[k] = el ? Math.round(el.getBoundingClientRect().height) : null;
        }
        return out;
    });

const handleRect = (which) =>
    cdp.call((w) => {
        const el = document.querySelector(`[data-hs-split-handle="${w}"]`);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + Math.min(60, b.width / 2)), y: Math.round(b.top + b.height / 2), h: Math.round(b.height) };
    }, which);

const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints:
            type === 'touchEnd'
                ? []
                : [{ id: 0, x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 }],
    });

/** 按住手柄纵向拖 dy（触摸！`onDown` 对 mouse 直接 return，走的是桌面那条分割条）。 */
const dragHandle = async (which, dy) => {
    const r = await handleRect(which);
    if (!r) throw new Error(`找不到手柄 ${which}`);
    await touch('touchStart', r.x, r.y);
    await sleep(60);
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
        await touch('touchMove', r.x, r.y + (dy * i) / steps);
        await sleep(45);
    }
    await touch('touchEnd', 0, 0);
    await sleep(600);
};

/**
 * 按"这一对的高度"算拖动量。
 *
 * 🕳️ 第一版直接写死 +60/+40 —— 而四块同屏时每块只有 **75px**，`+60` 相当于把分界推到
 * 这一对的 90% 位置 ⇒ 越过 `COLLAPSE_BOTTOM=0.86` ⇒ 触发"**拖到底自动关闭那一块**"
 * （这是**既有规格**："某个界面所得太小则自动关闭"）。于是判据看到的是"面板被关掉"，
 * 误判成"拖动没按预期改高度"。⇒ 拖动量一律按 pair 高度的比例给，并**避开阈值**。
 */
const pairSpan = async (aKey, bKey) => {
    const h = await heights();
    return (h[aKey] ?? 0) + (h[bKey] ?? 0);
};

/**
 * 把某条内部分界**归中**（50/50）。
 *
 * 🕳️ 为什么必须先归中：权重是**持久化**的，上一次探针跑完可能留下"参数 172px / 文件 23px"
 * 这种极偏的状态 —— 那时分界位置已经在 0.88，**一起手就跨过 COLLAPSE_BOTTOM(0.86)**
 * ⇒ 直接触发"拖到底自动关闭那一块"，判据看到的是"面板消失"，与拖动灵敏度无关。
 * （归中本身也是在用这个功能：拖的正是同一根手柄。）
 */
const balanceInner = async (upperKey, lowerKey) => {
    const h = await heights();
    const up = h[upperKey] ?? 0;
    const lo = h[lowerKey] ?? 0;
    if (up <= 0 || lo <= 0) return;
    const dy = Math.round((up + lo) / 2 - up); // 想让它变成 (up+lo)/2
    if (Math.abs(dy) < 4) return;
    await dragHandle(lowerKey, dy);
};

/** 可见的下方面板顺序（用于取"上一块"）。 */
const visibleLower = async () => {
    const h = await heights();
    return ['params', 'files', 'notes'].filter((k) => (h[k] ?? 0) > 0);
};

/* ── 0. 四块同屏 ─────────────────────────────────────────────────── */
for (const tab of ['timeline', 'params', 'files', 'notes']) await openPane(tab);
await sleep(3000);
/* 先把两条内部分界都归中（否则可能一上手就在塌陷阈值的边上） */
await balanceInner('params', 'files');
await balanceInner('files', 'notes');
await sleep(500);
const h0 = await heights();
console.log('▸ 四块高度：' + JSON.stringify(h0));
check(
    'E25-A 四块同屏（轨道/参数/文件/记事本）',
    h0.timeline > 40 && h0.params > 8 && h0.files > 8 && h0.notes > 8,
    JSON.stringify(h0),
);

/* ── B. 拖「文件」标题条（往下）⇒ **参数变大 / 文件变小**，轨道与记事本不动 ─────
   ⚠️ 方向：手柄坐在**下面那一块的顶端**，往下拖 = 把分界线往下推 = **上面那块变大**。
   （第一版探针把期望写反了，误报成失败。） */
const span1 = await pairSpan('params', 'files');
const dy1 = Math.round(span1 * 0.18); // 18%：明显看得见，又离 0.86/0.14 的塌陷阈值很远
await dragHandle('files', dy1);
const h1 = await heights();
console.log(`▸ 拖文件 +${dy1}（pair=${span1}）后：` + JSON.stringify(h1));
const dB = {
    params: (h1.params ?? 0) - (h0.params ?? 0),
    files: (h1.files ?? 0) - (h0.files ?? 0),
    timeline: (h1.timeline ?? 0) - (h0.timeline ?? 0),
    notes: (h1.notes ?? 0) - (h0.notes ?? 0),
};
check(
    'E25-B 拖「文件」标题条（往下）⇒ **参数变大 / 文件变小**，轨道块与记事本**不变**',
    dB.params > dy1 * 0.5 &&
        dB.files < -dy1 * 0.5 &&
        Math.abs(dB.timeline) <= 3 &&
        Math.abs(dB.notes) <= 3,
    `Δ=${JSON.stringify(dB)}（期望 params≈+${dy1}、files≈-${dy1}、timeline≈0、notes≈0）`,
);

/* ── C. 拖「记事本」标题条（往下）⇒ 文件变大 / 记事本变小 ───────────── */
const span2 = await pairSpan('files', 'notes');
const dy2 = Math.round(span2 * 0.18);
await dragHandle('notes', dy2);
const h2 = await heights();
console.log(`▸ 拖记事本 +${dy2}（pair=${span2}）后：` + JSON.stringify(h2));
const dC = {
    files: (h2.files ?? 0) - (h1.files ?? 0),
    notes: (h2.notes ?? 0) - (h1.notes ?? 0),
    params: (h2.params ?? 0) - (h1.params ?? 0),
    timeline: (h2.timeline ?? 0) - (h1.timeline ?? 0),
};
check(
    'E25-C 拖「记事本」标题条（往下）⇒ **文件变大 / 记事本变小**，参数与轨道块不变',
    dC.files > dy2 * 0.5 &&
        dC.notes < -dy2 * 0.5 &&
        Math.abs(dC.params) <= 3 &&
        Math.abs(dC.timeline) <= 3,
    `Δ=${JSON.stringify(dC)}（期望 files≈+${dy2}、notes≈-${dy2}、params≈0、timeline≈0）`,
);

/* ── D. 权重落盘 ─────────────────────────────────────────────────── */
const stored = await cdp.call(() => {
    try {
        return localStorage.getItem('hifishifter.mobileLowerWeights');
    } catch {
        return null;
    }
});
console.log('▸ localStorage：' + JSON.stringify(stored));
check(
    'E25-D 权重写进 localStorage（下次启动保持）',
    typeof stored === 'string' && stored.includes('files'),
    `value=${stored}`,
);

console.log(`\n── E25 多窗口分别调高：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
