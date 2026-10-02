#!/usr/bin/env node
/**
 * E36 判据 —— 用户点名的三条（2026-10-02）：
 *   · #5 文案规则：**「关闭」= 调完就已经生效；「保存」= 还能取消**
 *     ⇒ 即时生效的设置窗收尾按钮必须是「关闭」，不能是「确定」。
 *   · #8 三处的字号统一到令牌 `--hs-font-menu-item`（13.5px）。
 *   · #7 `ModelManagerDialog` 多语言化（key 完整性由单测 `src/i18n/locales.test.ts` 钉死）。
 *
 * 判据：
 *   E36-A1 「吸附/网格设置」收尾按钮 = 关闭、且**没有**「确定」
 *   E36-A2 「分割过渡设置」同理
 *   E36-B  工具菜单（选择/绘制）菜单项字号 = 13.5px
 *   E36-C  手机顶栏菜单（文件）菜单项字号 = 13.5px
 *   E36-D  `VerticalDualPanel`（👁 参数与覆盖层）标签字号 —— **不可判**（`showEye` 默认 false，平板专用）
 *   E36-E  **能测到**的几处字号去重后只剩一个值，且等于令牌
 *   E36-F  「模型管理」窗 —— **不可判**（`HS_MODELS_BUNDLED = true` ⇒ 该入口按设计隐藏）
 *
 * 🕳️ 两个坑（本轮踩到，写在这里免得下次再踩）：
 *   ① 这三个设置窗是 **Radix `Dialog`**，根节点是 `role="dialog"`、**没有** `data-hs-modal`
 *      （那只标在三个**自绘**弹窗上）⇒ 选择器要用 `[role="dialog"]` 并按**标题文本**定位。
 *   ② 上一个弹窗**没关掉就开下一个**会失败（Radix 的模态层互相打架）⇒ 每次开之前先 Escape。
 *   ③ 顶栏「模型管理…」那一项在 **`HS_MODELS_BUNDLED = true` 时根本不渲染**
 *      （`MobileTopBar.tsx:643`）⇒ 设备上无法驱动，只能标不可判。
 *
 * 用法：node scripts/_probe-e36-consistency.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
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
    console.log(`${ok ? '✅' : '🔴'} ${name}`);
    if (detail !== undefined) console.log(`     ${detail}`);
    if (ok) pass += 1;
    else fail += 1;
};
const skip = (name, why) => console.log(`⬜ ${name}\n     ↳ **不可判**：${why}`);

const token = () =>
    cdp.call(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--hs-font-menu-item').trim(),
    );

/** 打开一个设置弹窗（走产品自己的事件）。 */
const openSettings = (which) =>
    cdp.call((w) => {
        window.dispatchEvent(new CustomEvent('hs-open-settings', { detail: { which: w } }));
        return true;
    }, which);

const escape = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await sleep(400);
};

/** 所有 `role="dialog"` 的摘要（文本头 + 末尾按钮文案）。 */
const dialogs = () =>
    cdp.call(() =>
        [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
            text: (d.textContent ?? '').trim().slice(0, 40),
            buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
        })),
    );

/** 在元素上派发一次真正的 click（顶栏菜单只能这么开 —— 触摸 tap 不稳，见 docs/17）。 */
const clickBody = (selector) =>
    cdp.call((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
    }, selector);

/** 读某个容器里的菜单项字号集合。 */
const itemFonts = (containerSel, itemSel) =>
    cdp.call(
        (cs, is) => {
            const root = document.querySelector(cs);
            if (!root) return null;
            const items = [...root.querySelectorAll(is)].filter(
                (e) => (e.textContent ?? '').trim().length > 0,
            );
            if (items.length === 0) return null;
            return {
                n: items.length,
                sizes: [...new Set(items.map((e) => getComputedStyle(e).fontSize))],
                sample: items.slice(0, 3).map((e) => (e.textContent ?? '').trim()).join(' / '),
            };
        },
        containerSel,
        itemSel,
    );

const TOK = await token();
console.log(`▸ 令牌 --hs-font-menu-item = ${TOK}`);

/* ── E36-A1 / A2：即时生效的设置窗，收尾按钮应是「关闭」 ─────────────── */
for (const [which, title, id] of [
    ['snap-grid', '吸附/网格设置', 'E36-A1'],
    ['split-transition', '分割过渡设置', 'E36-A2'],
]) {
    await escape(); // 🔴 必须先关掉上一个，否则 Radix 的模态层互相打架、新窗打不开
    await openSettings(which);
    await sleep(950);
    const all = await dialogs();
    const dlg = all.find((d) => d.text.startsWith(title));
    const tail = (dlg?.buttons ?? []).filter(Boolean).slice(-3);
    console.log(`   [${title}] 末尾按钮 = ${JSON.stringify(tail)}`);
    check(
        `${id} 「${title}」收尾按钮是「关闭」且**没有**「确定」（即时生效 ⇒ 无从取消）`,
        Boolean(dlg) && tail.includes('关闭') && !tail.includes('确定'),
        dlg ? `按钮 ${JSON.stringify(dlg.buttons.slice(-4))}` : `没找到标题为「${title}」的对话框（现有：${JSON.stringify(all.map((d) => d.text.slice(0, 12)))}）`,
    );
    await escape();
}

/* ── E36-B：工具菜单（选择/绘制）字号 ──
 * 🔴 前置：`[data-hs-select-anchor]` 在 **`MobileParamToolRow`**（参数工具行）里，
 *    而那一行**只有参数面板打开时才渲染** ⇒ 不开面板连锚点都找不到
 *    （第一次跑就是栽在这：`itemFonts` 一直 null，看着像"菜单开不了"）。 */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    return true;
});
await sleep(1500);
const anchors = await cdp.call(() => ({
    paramRow: Boolean(document.querySelector('.hs-param-toolrow')),
    selectAnchor: Boolean(document.querySelector('[data-hs-select-anchor]')),
}));
console.log(`▸ 参数工具行前置：${JSON.stringify(anchors)}`);

let toolMenu = null;
for (let i = 0; i < 4 && toolMenu === null; i += 1) {
    await clickBody('[data-hs-select-anchor]');
    await sleep(500);
    toolMenu = await itemFonts('[data-hs-select-tool-menu]', '.hs-tool-menu__item');
}
console.log(`▸ 工具菜单：${JSON.stringify(toolMenu)}`);
check(
    'E36-B 工具菜单（选择/绘制）菜单项字号 = 13.5px',
    toolMenu !== null && toolMenu.sizes.length === 1 && toolMenu.sizes[0] === '13.5px',
    `条目 ${toolMenu?.n} 个；字号 = ${JSON.stringify(toolMenu?.sizes)}（原来是 12px）`,
);
await escape();

/* ── E36-C：手机顶栏菜单字号 ──────────────────────────────────────── */
const topOpened = await cdp.call(() => {
    const btn = [...document.querySelectorAll('button')].find(
        (b) => (b.textContent ?? '').trim() === '文件',
    );
    if (!btn) return false;
    btn.click();
    return true;
});
await sleep(600);
const topMenu = await itemFonts('[role="menu"]', 'button');
console.log(`▸ 顶栏「文件」菜单打开=${topOpened}：${JSON.stringify(topMenu)}`);
check(
    'E36-C 手机顶栏菜单项字号 = 13.5px',
    topMenu !== null && topMenu.sizes.length === 1 && topMenu.sizes[0] === '13.5px',
    `条目 ${topMenu?.n} 个；字号 = ${JSON.stringify(topMenu?.sizes)}`,
);
await escape();

/* ── E36-D：`VerticalDualPanel`（👁 参数与覆盖层）标签字号 ── */
const dual = await cdp.call(() => {
    const root = [...document.querySelectorAll('[role="menu"]')].find(
        (m) => (m.getAttribute('aria-label') ?? '') === '参数与覆盖层',
    );
    if (!root) return null;
    const spans = [...root.querySelectorAll('span')].filter(
        (e) => (e.textContent ?? '').trim().length > 0,
    );
    if (spans.length === 0) return null;
    return {
        n: spans.length,
        sizes: [...new Set(spans.map((e) => getComputedStyle(e).fontSize))],
    };
});
if (dual === null) {
    skip(
        'E36-D `VerticalDualPanel`（👁 参数与覆盖层）标签字号 = 13.5px',
        '该面板 `showEye` 默认 `false`（**平板专用**，`MobileBottomBar.tsx:978`），手机上到不了。' +
            '源码证据：该处已写 `fontSize: "var(--hs-font-menu-item)"`',
    );
} else {
    check(
        'E36-D `VerticalDualPanel`（👁 参数与覆盖层）标签字号 = 13.5px',
        dual.sizes.length === 1 && dual.sizes[0] === '13.5px',
        `标签 ${dual.n} 个；字号 = ${JSON.stringify(dual.sizes)}（原来是 13px）`,
    );
}

/* ── E36-E：**能测到的**几处去重后只剩一个值，且 == 令牌 ───────────── */
const all = [...(toolMenu?.sizes ?? []), ...(topMenu?.sizes ?? []), ...(dual?.sizes ?? [])];
const uniq = [...new Set(all)];
check(
    'E36-E 能测到的各处字号**去重后只剩一个值**，且等于令牌 `--hs-font-menu-item`',
    uniq.length === 1 && uniq[0] === TOK,
    `去重 = ${JSON.stringify(uniq)}；令牌 = ${TOK}`,
);

/* ── E36-F：「模型管理」窗（本包不可达，如实标不可判） ─────────────── */
const fReachable = await cdp.call(() => {
    const items = [...document.querySelectorAll('[role="menu"] button')];
    return items.some((b) => (b.textContent ?? '').includes('模型管理'));
});
if (!fReachable) {
    skip(
        'E36-F 「模型管理」窗文案取自 i18n',
        '**本包不可达**：模型是内置的（`HS_MODELS_BUNDLED = true`），' +
            '`MobileTopBar.tsx:643` 因此**不渲染**「模型管理…」入口 ⇒ 设备上无法驱动。' +
            '该条的证据由单测 `src/i18n/locales.test.ts`（15 个 key × 5 语种齐全 + 占位符一致）+ `tsc` 提供',
    );
} else {
    const opened = await cdp.call(() => {
        const it = [...document.querySelectorAll('[role="menu"] button')].find((b) =>
            (b.textContent ?? '').includes('模型管理'),
        );
        if (!it) return false;
        it.click();
        return true;
    });
    await sleep(900);
    const all2 = await dialogs();
    const dlg = all2.find((d) => d.text.includes('模型管理'));
    check(
        'E36-F 「模型管理」窗打开且文案取自 i18n（zh-CN：模型管理 / 内置的声码器…）',
        Boolean(dlg) && dlg.text.includes('声码器'),
        `openVia=${opened}；找到=${Boolean(dlg)} text=${dlg?.text ?? 'null'}`,
    );
    await escape();
}

console.log(`\n── E36 一致性：通过 ${pass} / 失败 ${fail} ──`);
process.exit(fail === 0 ? 0 : 1);
