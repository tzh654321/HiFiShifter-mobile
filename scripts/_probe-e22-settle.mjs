#!/usr/bin/env node
/**
 * E22 第四刀「拖动收尾的平滑」设备判据 —— 分屏边界抬手后**从指尖位置滑到落位值**。
 *
 * 背景：拖动期间 `paintRatio()` 每帧**直接写 DOM** 的 `flexGrow`（不重渲整树），
 * 抬手时 App 才 `clamp(ratio, 0.15, 0.85)` 落位；跨过 `COLLAPSE_*`（0.14 / 0.86）
 * 还会直接关面板 ⇒ 修前是**瞬跳**（0.93 → 全屏）。
 * 修后：抬手时给容器挂 `data-hs-split-settling`，CSS 只在这段窗口里对 `flex-grow`
 * 上过渡（180ms）；拖动中**绝不能**带过渡（否则每帧写一次都会重启 = 橡皮筋，I-2 骂过）。
 *
 * 🕳️ 判"有没有过渡"必须看 **`transitionDuration`**，不能看 `transitionProperty`：
 * 后者的 CSS 初始值就是 `all`、且 `transition-duration` 默认 `0s` ⇒ 只看属性名会把
 * "根本没有过渡"误判成"有"。本探针用 `flexDur`（flex-grow / all 的实际时长）判定。
 *
 * 判据（5 条）：
 *   E22-S1 拖动过程中 flex-grow **时长 0s**（跟手优先，不是橡皮筋）
 *   E22-S2 抬手后容器挂上 `data-hs-split-settling`、且 flex-grow **时长 > 0**
 *   E22-S3 采样到**中间高度**（≥2 帧既非起点也非终点）⇒ 是滑过去而不是瞬跳
 *   E22-S4 收尾窗口结束后时长回到 0s（过渡不常驻）
 *   E22-S5 对照 `body[data-hs-no-anim]`：抬手后**时长仍是 0s**
 *
 * 用法：node scripts/_probe-e22-settle.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
try {
    /* ⚠️ 与 `_probe-mobile-split.mjs` 对齐：不先开触摸仿真直接 `dispatchTouchEvent`
       会**卡死 30s 超时**。坐标也要取整，并带 radius/force。 */
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} catch {
    /* ignore */
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p) => ({
            id: p.id ?? 0,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });

/** 页内公共部分：算"flex-grow 的实际过渡时长"（秒）—— 直接内联进下面两个页内函数，
 *  ⚠️ 不要用 `eval(常量字符串)` 注入：`const` 声明不会泄漏到外层函数作用域（实测报
 *  `flexDurOf is not defined`）。 */
const FLEX_DUR_SRC = `(function flexDurOf(el) {
        if (!el) return null;
        const cs = getComputedStyle(el);
        const props = cs.transitionProperty.split(',').map((s) => s.trim());
        const durs = cs.transitionDuration.split(',').map((s) => parseFloat(s) || 0);
        let max = 0;
        props.forEach((p, i) => {
            const d = durs.length === 1 ? durs[0] : (durs[i % durs.length] ?? 0);
            if ((p === 'flex-grow' || p === 'all') && d > max) max = d;
        });
        return { props, durs, flexDur: max };
    })`;

const geo = () =>
    cdp.call(
        (durSrc) => {
            const flexDurOf = eval(durSrc);
            const c = document.querySelector('[data-hs-mobile-split]');
            const pane = document.querySelector('[data-hs-pane="timeline"]');
            const handle = document.querySelector('[data-hs-split-handle="param-toolbar"]');
            if (!c) return null;
            const cr = c.getBoundingClientRect();
            const hr = handle ? handle.getBoundingClientRect() : null;
            return {
                top: Math.round(cr.top),
                h: Math.round(cr.height),
                settling: c.hasAttribute('data-hs-split-settling'),
                kids: c.children.length,
                kidsGrow: [...c.children].map((e) => Number(e.style.flexGrow || 0).toFixed(3)),
                first: flexDurOf(c.children[0]),
                paneH: pane ? Math.round(pane.getBoundingClientRect().height) : null,
                handleY: hr ? Math.round(hr.top + hr.height / 2) : null,
                handleX: hr ? Math.round(hr.left + 24) : null,
            };
        },
        FLEX_DUR_SRC,
    );

const armSampler = (ms) =>
    cdp.call(
        (durSrc, windowMs) => {
            const flexDurOf = eval(durSrc);
            window.__stl = [];
            const t0 = performance.now();
            const tick = () => {
                const c = document.querySelector('[data-hs-mobile-split]');
                const pane = document.querySelector('[data-hs-pane="timeline"]');
                const fd = c && c.children[0] ? flexDurOf(c.children[0]) : null;
                window.__stl.push({
                    dt: Math.round(performance.now() - t0),
                    settling: c ? c.hasAttribute('data-hs-split-settling') : null,
                    grow: c && c.children[0] ? Number(c.children[0].style.flexGrow || 0).toFixed(3) : null,
                    flexDur: fd ? fd.flexDur : null,
                    h: pane ? Math.round(pane.getBoundingClientRect().height) : null,
                });
                if (performance.now() - t0 < windowMs) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            return true;
        },
        FLEX_DUR_SRC,
        ms,
    );

const readSampler = () =>
    cdp.call(() => {
        const l = window.__stl || [];
        const hs = l.map((s) => s.h).filter((h) => h !== null);
        const lo = Math.min(...hs);
        const hi = Math.max(...hs);
        const mid = hs.filter((h) => h > lo + 4 && h < hi - 4).length;
        const settlingFrames = l.filter((s) => s.settling).length;
        return {
            samples: l.length,
            first: l[0] ?? null,
            last: l[l.length - 1] ?? null,
            lo,
            hi,
            mid,
            settlingFrames,
            /* 收尾期间出现过的最大 flex-grow 时长（秒） */
            maxFlexDur: Math.max(0, ...l.filter((s) => s.settling).map((s) => s.flexDur ?? 0)),
            anyFlexDur: Math.max(0, ...l.map((s) => s.flexDur ?? 0)),
        };
    });

const setupSplit = async () => {
    for (const tab of ['params', 'timeline']) {
        await cdp.call(
            (t) => {
                window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: t } }));
                return true;
            },
            tab,
        );
        await sleep(1100);
    }
};

/* ── 准备：轨道 + 参数两块同屏 ─────────────────────────────────────────── */
await setupSplit();
const g0 = await geo();
console.log(
    `▸ 就绪：块数=${g0?.kids} 容器 h=${g0?.h} 面板 h=${g0?.paneH} 收尾标记=${g0?.settling}` +
        ` flexDur=${g0?.first?.flexDur}s props=${JSON.stringify(g0?.first?.props)}`,
);
if (!g0 || g0.kids < 2 || !g0.handleY) {
    console.log('🔴 需要"轨道 + 参数"分屏且能找到 `[data-hs-split-handle="param-toolbar"]`');
    cdp.close();
    process.exit(1);
}

/* ── 场景：拖到 0.93（越过 COLLAPSE_BOTTOM=0.86 ⇒ 关掉非轨道面板 ⇒ 轨道块涨到全屏） ── */
const toY = Math.round(g0.top + 0.93 * g0.h);
await touch('touchStart', [{ x: g0.handleX, y: g0.handleY }]);
await sleep(60);
const during = await geo();
for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: g0.handleX, y: Math.round(g0.handleY + ((toY - g0.handleY) * i) / 6) }]);
    await sleep(45);
}
const duringEnd = await geo();
check(
    'E22-S1 拖动过程中 flex-grow **时长 0s**（跟手优先，不是橡皮筋）',
    (duringEnd.first?.flexDur ?? -1) === 0 && during.settling === false,
    `拖动首帧 flexDur=${during.first?.flexDur}s / 末帧 ${duringEnd.first?.flexDur}s；收尾标记=${during.settling}`,
);

/* 抬手 → 采 900ms */
await armSampler(900);
await touch('touchEnd', []);
await sleep(1100);
const s = await readSampler();
const after = await geo();

check(
    'E22-S2 抬手后容器挂上 `data-hs-split-settling`、且 flex-grow 时长 > 0',
    s.settlingFrames > 0 && s.maxFlexDur > 0,
    `收尾帧 ${s.settlingFrames}/${s.samples}；收尾期 flex-grow 时长 ${s.maxFlexDur}s`,
);
check(
    'E22-S3 采样到**中间高度**（≥2 帧既非起点也非终点）⇒ 是滑过去而不是瞬跳',
    s.mid >= 2,
    `高度 ${s.lo}px → ${s.hi}px，中间帧 ${s.mid}；首帧 ${JSON.stringify(s.first)}`,
);
check(
    'E22-S4 收尾窗口结束后时长回到 0s（过渡不常驻）',
    after.settling === false && (after.first?.flexDur ?? -1) === 0,
    `结束后 settling=${after.settling} flexDur=${after.first?.flexDur}s 最终 grow=${JSON.stringify(after.kidsGrow)}`,
);

/* ── 对照：关掉动效后，抬手不应有过渡（要先恢复"两块"） ───────────────── */
await setupSplit();
await cdp.call(() => {
    document.body.setAttribute('data-hs-no-anim', '');
    return true;
});
await sleep(300);
const g1 = await geo();
if (g1 && g1.kids >= 2 && g1.handleY) {
    const toY2 = Math.round(g1.top + 0.5 * g1.h);
    await touch('touchStart', [{ x: g1.handleX, y: g1.handleY }]);
    await sleep(60);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ x: g1.handleX, y: Math.round(g1.handleY + ((toY2 - g1.handleY) * i) / 4) }]);
        await sleep(45);
    }
    await armSampler(600);
    await touch('touchEnd', []);
    await sleep(800);
    const s2 = await readSampler();
    check(
        'E22-S5 对照 `body[data-hs-no-anim]`：抬手后时长仍是 0s',
        s2.anyFlexDur === 0,
        `对照期出现过的最大 flex-grow 时长=${s2.anyFlexDur}s（收尾帧 ${s2.settlingFrames}）`,
    );
} else {
    check('E22-S5 对照', false, `对照场景不满足（块数=${g1?.kids}）`);
}
await cdp.call(() => {
    document.body.removeAttribute('data-hs-no-anim');
    return true;
});

console.log(`\n── E22 第四刀（拖动收尾）汇总：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
