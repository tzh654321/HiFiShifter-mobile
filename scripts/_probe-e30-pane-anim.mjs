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

/**
 * 确保某个面板**真的关掉**（返回是否成功）。
 *
 * 🔴 为什么不能只 `setPane(which, false)` 一次：`hs-mobile-close-panel` 是 **toggle** 语义
 *    ⇒ 面板本来**已经关着**时，派发它等于把它**打开**（同一坑在 `docs/17` 与 REGISTRY 里都记过）。
 *    2026-10-02 实测：E30 两条判据全红，就是"关干净后"那一步反而把面板打开了，
 *    `sampleAfterOpen` 随后量到的是"上一次播完留下的 `finished`" ⇒ 判据自欺。
 *    ⇒ 正确做法：**先读状态、只在开着时派发**，循环到确实不在场为止。
 */
const ensureClosed = async (which, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if ((await paneState(which)).present === false) return true;
        await cdp.call((w) => {
            window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: w } }));
        }, which);
        await sleep(650);
    }
    return (await paneState(which)).present === false;
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
const aClosed = await ensureClosed('files');
const closed1 = await paneState('files');
console.log(`▸ [视图菜单] 关干净后（成功=${aClosed}）：` + JSON.stringify(closed1));
if (!aClosed) {
    check('E30-A 视图菜单开面板 ⇒ 动画真的播了', false, '前置不干净：files 面板关不掉');
} else {
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
}

/* 关掉，给下一条留干净状态（同样要"先读状态再派发"，别用 toggle 当关闭） */
await ensureClosed('files');

/* ── 2. 双击**轨道泳道**路径（用户口径的另一条入口） ──────────────────
 *
 * 🔴 修一处探针错位（2026-10-02）：原来双击的是 `[data-hs-track-row]` 的**中心** ——
 *    那是**左侧轨道头**（`TrackList`）里的行。而监听器挂在 `host.getContainer()`
 *    （时间线的滚动容器）上（`TimelinePanel.tsx` 的 `onTrackDblClickPhone`）
 *    ⇒ 点在轨道头**根本收不到 `dblclick`** ⇒ 这条判据一直假红（TASKS 里记的
 *    "B 段前置不干净、未定论"就是这个）。
 *
 * 正确目标是**泳道本身**：纵向取一条轨道行（`[data-hs-track-row]`）的中心高度，
 * 横向取容器中部偏右（泳道空白处 —— 落在音频块上是另一条路径）。
 * 前置也补上：先把 `params` 真的关掉（`ensureClosed`，别用 toggle 当关闭），
 * 避免拿"上一次播完留下的 finished"自欺。 */
const bClosed = await ensureClosed('params');
const target = await cdp.call(() => {
    const vp = window.__hsViewport?.();
    const r = vp?.containerRect;
    const rows = [...document.querySelectorAll('[data-hs-track-row]')].map((e) => {
        const b = e.getBoundingClientRect();
        return Math.round(b.top + b.height / 2);
    });
    if (!r || rows.length === 0) return null;
    /* 取第 2 行（第 1 行常被拍数栏/工具条视觉压住，且更靠近上边界） */
    const y = rows[1] ?? rows[0];
    /* 纵向必须落在容器内 */
    if (y < r.top + 4 || y > r.top + r.height - 4) return null;
    return {
        x: Math.round(r.left + r.width * 0.6),
        y,
        rows,
        rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
});
console.log('▸ 双击目标（泳道）：' + JSON.stringify(target));
const before2 = await paneState('params');
console.log('▸ [双击泳道] 起手状态：' + JSON.stringify(before2));
if (target && bClosed && before2.present === false) {
    for (const [type, extra] of [
        ['mousePressed', { button: 'left', buttons: 1, clickCount: 1 }],
        ['mouseReleased', { button: 'left', buttons: 0, clickCount: 1 }],
        ['mousePressed', { button: 'left', buttons: 1, clickCount: 2 }],
        ['mouseReleased', { button: 'left', buttons: 0, clickCount: 2 }],
    ]) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, ...extra });
        await sleep(45);
    }
    /* 采样一小段，看 opacity 是否真的动过（只看 animationName 会被"规则命中"骗） */
    const ser2 = [];
    for (let i = 0; i < 10; i += 1) {
        ser2.push(await paneState('params'));
        await sleep(28);
    }
    const opened2 = ser2.some((s) => s.present);
    const names2 = [...new Set(ser2.flatMap((s) => s.names ?? []))];
    const moved2 = new Set(ser2.filter((s) => s.present).map((s) => s.opacity)).size > 1;
    const running2 = ser2.some((s) => (s.states ?? []).includes('running'));
    console.log('▸ [双击泳道] opacity 序列：' + JSON.stringify(ser2.map((s) => s.opacity)));
    check(
        'E30-B 双击**轨道泳道**开面板 ⇒ 面板出现且动画真的在播（opacity 有变化 / 抓到 running）',
        opened2 && (moved2 || running2),
        `opacity 序列=${JSON.stringify(ser2.map((s) => s.opacity))} names=${JSON.stringify(names2)} ` +
            `states=${JSON.stringify([...new Set(ser2.flatMap((s) => s.states ?? []))])}`,
    );
} else {
    check(
        'E30-B 双击**轨道泳道**开面板 ⇒ 面板出现且动画真的在播',
        false,
        target
            ? `前置不干净：params 关不掉（ensureClosed=${bClosed}）或起手时仍开着（${JSON.stringify(before2)}）`
            : '找不到泳道目标（容器 rect 或轨道行缺失）',
    );
}

console.log(`\n── E30 分屏动画路径：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
