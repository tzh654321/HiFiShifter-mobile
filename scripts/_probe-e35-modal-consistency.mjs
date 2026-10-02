#!/usr/bin/env node
/**
 * E35「设计统一化」设备判据 —— 弹窗族（用户点名的那一族）。
 *
 * 用户口径：「同类菜单/窗口用相同的打开动画、背景处理、控件样式、字号、描述词……
 * 就比如**储存设置的窗口位置、背景模糊、层级顺序**都有问题，**不要只做这一例**」。
 * 盘点见 `docs/19-设计一致性盘点.md`；落地规则在 `index.css` 的 `[data-hs-modal]` 一节。
 *
 * 判据（9 条）：
 *   E35-D1 三个自绘弹窗的 **top 一致**，且等于令牌 `--hs-modal-top`
 *   E35-D2 `max-height` 一致，且 **面板底边不越过视口**（"底部被切"是用户报的原始症状）
 *   E35-D3 **层级一致**：面板 = `--hs-z-modal`、背板 = 面板 − 1
 *   E35-D4 **背板统一**：三个背板底色相同、且都带 `blur`（原来是 `rgba(0,0,0,0.45)` 无模糊）
 *   E35-D5 **入场动画**统一：三个面板都跑 `hs-fade-in`（原来自绘弹窗一个动画都没有）
 *   E35-D6 **关闭文案**统一：三个关闭按钮都是「关闭」
 *   E35-D7 **出场共规**：关闭后节点仍在 DOM、带 `data-hs-leaving`、跑 `hs-fade-out`，随后消失
 *   E35-D8 对照：`body[data-hs-no-anim]` 下关闭**立即**消失（与改造前一致）
 *   E35-D9 **层级阶梯单调**：`:root` 令牌满足 search > ghost > modal > menu > panel > transient
 *
 * 用法：node scripts/_probe-e35-modal-consistency.mjs [serial]
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
    console.log('🔴 应用没在跑');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/** 打开某个自绘设置弹窗（走产品自己的事件，`App.tsx` 的 `SettingsOverlays` 监听它）。 */
const openDialog = (which) =>
    cdp.call((w) => {
        window.dispatchEvent(new CustomEvent('hs-open-settings', { detail: { which: w } }));
        return true;
    }, which);

/** 点面板里的关闭按钮（文案「关闭」那个）。 */
const closeDialog = () =>
    cdp.call(() => {
        const panel = document.querySelector('[data-hs-modal]');
        if (!panel) return false;
        const btn = [...panel.querySelectorAll('button')].find(
            (b) => (b.textContent ?? '').trim() === '关闭',
        );
        if (!btn) return false;
        btn.click();
        return true;
    });

/** 读当前弹窗的几何/样式（面板 + 背板 + 关闭按钮文案）。 */
const measure = () =>
    cdp.call(() => {
        const panel = document.querySelector('[data-hs-modal]');
        if (!panel) return null;
        const back = document.querySelector('[data-hs-modal-backdrop]');
        const cs = getComputedStyle(panel);
        const bs = back ? getComputedStyle(back) : null;
        const r = panel.getBoundingClientRect();
        const closeBtn = [...panel.querySelectorAll('button')].find(
            (b) => (b.textContent ?? '').trim().length > 0,
        );
        const closeAll = [...panel.querySelectorAll('button')].map((b) =>
            (b.textContent ?? '').trim(),
        );
        return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            innerH: window.innerHeight,
            cssTop: cs.top,
            maxH: cs.maxHeight,
            z: cs.zIndex,
            radius: cs.borderTopLeftRadius,
            backZ: bs ? bs.zIndex : null,
            backBg: bs ? bs.backgroundColor : null,
            backBlur: bs ? bs.backdropFilter : null,
            anims: panel.getAnimations().map((a) => a.animationName || '(js)'),
            buttons: closeAll,
            closeText: closeBtn ? (closeBtn.textContent ?? '').trim() : null,
        };
    });

/** 逐帧采样"目标还在不在 / 带不带 leaving / 跑什么动画"。 */
const armExitSampler = (ms) =>
    cdp.call((windowMs) => {
        window.__e35 = [];
        const t0 = performance.now();
        const tick = () => {
            const el = document.querySelector('[data-hs-modal]');
            window.__e35.push({
                dt: Math.round(performance.now() - t0),
                present: !!el,
                leaving: el ? el.hasAttribute('data-hs-leaving') : null,
                anims: el ? el.getAnimations().map((a) => a.animationName || '(js)') : [],
                opacity: el ? Number(getComputedStyle(el).opacity) : null,
            });
            if (performance.now() - t0 < windowMs) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    }, ms);

const readExitSampler = () =>
    cdp.call(() => {
        const l = window.__e35 || [];
        const leaving = l.filter((s) => s.leaving);
        const anims = new Set();
        for (const s of l) for (const a of s.anims) anims.add(a);
        return {
            frames: l.length,
            leavingFrames: leaving.length,
            firstLeaving: leaving[0] ?? null,
            lastLeaving: leaving[leaving.length - 1] ?? null,
            lastFrame: l[l.length - 1] ?? null,
            anims: [...anims],
        };
    });

const setNoAnim = (on) =>
    cdp.call((v) => {
        if (v) document.body.setAttribute('data-hs-no-anim', '');
        else document.body.removeAttribute('data-hs-no-anim');
        return document.body.hasAttribute('data-hs-no-anim');
    }, on);

const dialogPresent = () =>
    cdp.call(() => document.querySelector('[data-hs-modal]') !== null);

/* ── E35-D9 层级阶梯单调 ─────────────────────────────────────────────── */
const tokens = await cdp.call(() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    const num = (n) => Number(get(n).replace('px', ''));
    return {
        search: num('--hs-z-search'),
        ghost: num('--hs-z-ghost'),
        modal: num('--hs-z-modal'),
        menu: num('--hs-z-menu'),
        panel: num('--hs-z-panel'),
        transient: num('--hs-z-transient'),
        menubar: num('--hs-z-menubar'),
        scrim: num('--hs-z-menubar-scrim'),
        modalTop: get('--hs-modal-top'),
        backdrop: get('--hs-backdrop'),
    };
});
console.log(`▸ 令牌：${JSON.stringify(tokens)}`);
check(
    'E35-D9 层级阶梯**单调**（search > ghost > modal > menu > panel > transient；menubar > menubar-scrim）',
    tokens.search > tokens.ghost &&
        tokens.ghost > tokens.modal &&
        tokens.modal > tokens.menu &&
        tokens.menu > tokens.panel &&
        tokens.panel > tokens.transient &&
        tokens.menubar > tokens.scrim,
    `search=${tokens.search} ghost=${tokens.ghost} modal=${tokens.modal} menu=${tokens.menu} ` +
        `panel=${tokens.panel} transient=${tokens.transient} menubar=${tokens.menubar}/${tokens.scrim}`,
);

/* ── 逐个打开三个自绘弹窗，收集几何/样式 ──────────────────────────────── */
const CASES = [
    ['storage', '存储设置'],
    ['project', '工程设置'],
    ['metronome', '节拍器'],
];
const snaps = [];
for (const [which, label] of CASES) {
    await openDialog(which);
    await sleep(90); // 动画还在跑的时候读，才能看到 hs-fade-in
    const m = await measure();
    snaps.push({ which, label, ...(m ?? {}) });
    console.log(
        `▸ ${label}(${which})：top=${m?.top} maxH=${m?.maxH} z=${m?.z} 底边=${m?.bottom}/${m?.innerH} ` +
            `背板 z=${m?.backZ} bg=${m?.backBg} blur=${m?.backBlur} 动画=${JSON.stringify(m?.anims)} ` +
            `按钮=${JSON.stringify(m?.buttons)}`,
    );
    await closeDialog();
    await sleep(900);
}

const got = snaps.filter((s) => s.top !== undefined);
if (got.length !== 3) {
    console.log(`🔴 前置不满足：只打开成功 ${got.length}/3 个弹窗（检查事件名与包版本）`);
    process.exit(1);
}

const uniq = (arr) => [...new Set(arr)];
const tops = uniq(got.map((s) => s.cssTop));
const maxHs = uniq(got.map((s) => s.maxH));
const zs = uniq(got.map((s) => String(s.z)));
const backZs = uniq(got.map((s) => String(s.backZ)));
const bgs = uniq(got.map((s) => s.backBg));
const animNames = uniq(got.flatMap((s) => s.anims));

check(
    'E35-D1 三个自绘弹窗 **top 一致** 且等于令牌 `--hs-modal-top`',
    tops.length === 1 && tops[0] === tokens.modalTop,
    `top = ${JSON.stringify(tops)}（令牌 = ${tokens.modalTop}）—— 改造前是 60 / 64 / 64`,
);
check(
    'E35-D2 `max-height` 一致，且**面板底边不越过视口**（"底部被切"的直接判据）',
    maxHs.length === 1 && got.every((s) => s.bottom <= s.innerH + 1),
    `max-height = ${JSON.stringify(maxHs)}；底边/视口 = ${got
        .map((s) => `${s.bottom}/${s.innerH}`)
        .join(' , ')}`,
);
check(
    'E35-D3 **层级一致**：面板 = `--hs-z-modal`，背板 = 面板 − 1',
    zs.length === 1 &&
        Number(zs[0]) === tokens.modal &&
        backZs.length === 1 &&
        Number(backZs[0]) === tokens.modal - 1,
    `面板 z = ${JSON.stringify(zs)}（令牌 ${tokens.modal}）；背板 z = ${JSON.stringify(backZs)}`,
);
check(
    'E35-D4 **背板统一**：三个底色相同且都带 `blur`（原来是 0.45 无模糊，与 Radix 弹窗不同档）',
    bgs.length === 1 && got.every((s) => String(s.backBlur).includes('blur')),
    `底色 = ${JSON.stringify(bgs)}；blur = ${JSON.stringify(uniq(got.map((s) => s.backBlur)))}`,
);
check(
    'E35-D5 **入场动画**统一：三个面板都跑 `hs-fade-in`',
    animNames.includes('hs-fade-in'),
    `读到的动画 = ${JSON.stringify(animNames)}`,
);
check(
    'E35-D6 **关闭文案**统一：三个弹窗的关闭按钮都是「关闭」',
    got.every((s) => s.buttons.includes('关闭')),
    got.map((s) => `${s.label}=${JSON.stringify(s.buttons)}`).join(' ; '),
);

/* ── E35-D7 出场共规：关闭后先淡出再卸载 ─────────────────────────────── */
await openDialog('storage');
await sleep(220);
await armExitSampler(700);
await closeDialog();
await sleep(760);
const exit = await readExitSampler();
const stillThere = await dialogPresent();
await setNoAnim(false);
await sleep(200);
check(
    'E35-D7 **出场共规**：关闭后节点仍在 DOM、带 `data-hs-leaving`、跑 `hs-fade-out`，随后消失',
    exit.leavingFrames > 0 &&
        exit.anims.includes('hs-fade-out') &&
        exit.lastFrame?.present === false &&
        !stillThere,
    `${exit.frames} 帧采样 / leaving ${exit.leavingFrames} 帧；动画 ${JSON.stringify(exit.anims)}；` +
        `首帧带 leaving 时 opacity=${exit.firstLeaving?.opacity}；末尾在场=${exit.lastFrame?.present}`,
);

/* ── E35-D8 对照：no-anim 下立即消失 ────────────────────────────────── */
await setNoAnim(true);
await sleep(120);
await openDialog('storage');
await sleep(200);
const noAnimAnims = await cdp.call(() => {
    const el = document.querySelector('[data-hs-modal]');
    return el ? el.getAnimations().map((a) => a.animationName || '(js)') : null;
});
await armExitSampler(500);
await closeDialog();
await sleep(560);
const exitNoAnim = await readExitSampler();
const goneNoAnim = !(await dialogPresent());
await setNoAnim(false);
check(
    'E35-D8 对照：`body[data-hs-no-anim]` 下**无入场动画**、关闭**立即消失**（无 leaving）—— 与改造前一致',
    (noAnimAnims ?? []).length === 0 && exitNoAnim.leavingFrames === 0 && goneNoAnim,
    `no-anim 下打开时动画 = ${JSON.stringify(noAnimAnims)}；关闭采样 leaving ${exitNoAnim.leavingFrames} 帧；` +
        `立即消失 = ${goneNoAnim}`,
);

/* ── 收尾：确保弹窗都关掉，别影响下一条探针 ──────────────────────────── */
await closeDialog();
await sleep(500);

console.log(`\n── E35 弹窗族一致性：通过 ${pass} / 失败 ${fail} ──`);
process.exit(fail === 0 ? 0 : 1);
