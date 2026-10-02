/**
 * E30 分屏弹出动画 · 路径覆盖判据（2026-10-02，用户口径）——
 *
 * > 「弹出分屏动画需要在**双击轨道**或**视图菜单**中点击时能生效」
 *
 * 只在"面板刚挂载"时量动画是没用的（`getComputedStyle(...).animationName` 只要
 * CSS 规则命中就非 `none`，哪怕这一帧压根没播）。这里改量**运行时**：
 * 触发开面板之后立刻读该面板上 `getAnimations()` 的条目（名称、时长、播放状态），
 * 并在 ~500ms 内采样 `opacity` 是否真的动过 —— 那才是"动画生效"的硬证据。
 *
 * 用法：node scripts/_probe-e30-pane-anim.mjs <serial>
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

/** 面板当前状态（开/关 + 有没有在播动画）。 */
const paneState = (which) =>
    cdp.call((w) => {
        const el = document.querySelector(`[data-hs-pane="${w}"]`);
        if (!el) return { present: false };
        const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
        return {
            present: true,
            opacity: +(+(getComputedStyle(el).opacity)).toFixed(3),
            names: anims.map((a) => a.animationName ?? a.id ?? '(?)'),
            states: anims.map((a) => a.playState),
            durations: anims.map((a) => a.effect?.getTiming?.().duration ?? null),
        };
    }, which);

const setPane = (which, open) =>
    cdp.call(
        (w, o) => {
            /* ⚠️ 事件契约（App.tsx）：`hs-mobile-switch-tab` **只能开**（`showMobilePanel`，
               累加语义）；关闭要用 `hs-mobile-close-panel` + `{ key }`（走 `toggleMobilePanel`）。
               第一版探针拿 `switch-tab` 传 `open:false` 当"关"，其实是空操作 ⇒ 面板一直开着
               ⇒ 量到的动画 state 全是 `finished`（旧的那次播完留下的），判据自欺。 */
            if (o) {
                window.dispatchEvent(
                    new CustomEvent('hs-mobile-switch-tab', { detail: { tab: w } }),
                );
            } else {
                window.dispatchEvent(
                    new CustomEvent('hs-mobile-close-panel', { detail: { key: w } }),
                );
            }
            return true;
        },
        which,
        open,
    );

const waitPane = async (which, open, ms = 6000) => {
    for (let i = 0; i < ms / 200; i += 1) {
        const st = await paneState(which);
        if (st.present === open) return st;
        await sleep(200);
    }
    return await paneState(which);
};

/** 开面板后**采一串** opacity / 动画状态 —— 只看"有没有 rules 命中"会被 finished 骗到。 */
const sampleAfterOpen = async (which, openFn) => {
    await openFn();
    const series = [];
    for (const t of [0, 60, 120, 240, 420]) {
        if (t > 0) await sleep(t - series[series.length - 1].t);
        const st = await paneState(which);
        series.push({ t, ...st });
    }
    return series;
};

/* ── 1. 视图菜单路径（先真关掉，再开） ─────────────────────────────── */
await setPane('files', false);
for (let i = 0; i < 20; i += 1) {
    if ((await paneState('files')).present === false) break;
    await sleep(200);
}
const closed1 = await paneState('files');
console.log('▸ [视图菜单] 关干净后：' + JSON.stringify(closed1));
const ser1 = await sampleAfterOpen('files', () => setPane('files', true));
for (const s of ser1) {
    console.log(`   +${String(s.t).padStart(3)}ms  present=${s.present} opacity=${s.opacity} names=${JSON.stringify(s.names)} states=${JSON.stringify(s.states)}`);
}
const moved1 = ser1.some((s, i) => i > 0 && s.opacity !== ser1[0].opacity);
const running1 = ser1.some((s) => (s.states ?? []).includes('running'));
check(
    'E30-A 视图菜单开面板 ⇒ 动画**真的播了**（opacity 有变化 / 抓到 running）',
    moved1 || running1,
    `opacity 序列=${JSON.stringify(ser1.map((s) => s.opacity))} states=${JSON.stringify(ser1.map((s) => s.states))}`,
);

/* 关掉，给下一条留干净状态 */
await setPane('files', false);
await sleep(1200);

/* ── 2. 双击轨道路径 ─────────────────────────────────────────────── */
const target = await cdp.call(() => {
    const row = document.querySelector('[data-hs-track-row]');
    if (!row) return null;
    const b = row.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
});
console.log('▸ 双击目标（轨道行）：' + JSON.stringify(target));
if (target) {
    const before = await paneState('params');
    for (const [type, extra] of [
        ['mousePressed', { button: 'left', buttons: 1, clickCount: 1 }],
        ['mouseReleased', { button: 'left', buttons: 0, clickCount: 1 }],
        ['mousePressed', { button: 'left', buttons: 1, clickCount: 2 }],
        ['mouseReleased', { button: 'left', buttons: 0, clickCount: 2 }],
    ]) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, ...extra });
        await sleep(45);
    }
    const instant2 = await paneState('params');
    await sleep(120);
    const during2 = await paneState('params');
    console.log('▸ [双击轨道] 之前：' + JSON.stringify(before));
    console.log('▸ [双击轨道] +120ms：' + JSON.stringify(during2));
    check(
        'E30-B 双击轨道开面板 ⇒ 面板上真的在播动画',
        Array.isArray(during2.names) && during2.names.length > 0,
        `present=${during2.present} names=${JSON.stringify(during2.names)} states=${JSON.stringify(during2.states)}`,
    );
} else {
    check('E30-B 双击轨道开面板 ⇒ 面板上真的在播动画', false, '找不到 [data-hs-track-row]');
}

console.log(`\n── E30 分屏动画路径：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
