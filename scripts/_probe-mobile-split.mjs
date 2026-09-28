#!/usr/bin/env node
/**
 * C5/C6 验收：**手机端分屏边界**
 *
 * 规格（`docs/15` / `prompt.md`）：
 *   · 全屏非轨道界面**从顶部下拉**进入分屏（分屏 = 轨道 + 先前那个界面）；
 *   · 分界线可拖，**拖到很接近底部或顶部时变回全屏**；
 *   · 上下拖动 **参数界面拍数栏 / 文件管理标题栏 / 记事本标题栏** 可更改分屏边界，
 *     某个界面所得太小则**自动关闭**。
 *
 * 手柄就是那三个标题条本身（App 侧按 `data-hs-split-handle` / `[data-hs-time-ruler="params"]`
 * 集中绑定），所以本探针**直接拖那三个元素**，不另造浮层。
 *
 * 比值口径：`ratio = (下方面板块上沿 − 容器上沿) / 容器高` —— 直接量 DOM，不看内部 state。
 *
 * 用法：node scripts/_probe-mobile-split.mjs --serial emulator-5554
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
    }
    return o;
}

/** 页面内：容器与两块面板的几何 + 四个面板的可见性（可见性只能从 DOM 判，redux 读不到）。 */
function inPageProbe() {
    const vis = (sel) => document.querySelector(sel) !== null;
    const c = document.querySelector('[data-hs-mobile-split]');
    if (c === null) return { error: 'no-mobile-split-container' };
    const cr = c.getBoundingClientRect();
    const kids = [...c.children].map((k) => {
        const r = k.getBoundingClientRect();
        return { top: Math.round(r.top), h: Math.round(r.height) };
    });
    const panels = {
        timeline: vis('[data-hs-time-ruler="timeline"]'),
        params: vis('[data-hs-time-ruler="params"]'),
        files: vis('[data-hs-split-handle="files"]'),
        notes: vis('[data-hs-split-handle="notes"]'),
    };
    /** 边界位置（有下方面板时才成立）：下方面板块的上沿在容器内的归一化位置。 */
    const ratio =
        kids.length >= 2 && cr.height > 0 ? +(((kids[1].top - cr.top) / cr.height).toFixed(4)) : null;
    const handleY = (sel) => {
        const el = document.querySelector(sel);
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2), h: Math.round(r.height) };
    };
    return {
        vw: innerWidth,
        vh: innerHeight,
        panels,
        children: kids.length,
        container: { top: Math.round(cr.top), h: Math.round(cr.height) },
        kids,
        ratio,
        paramsRuler: handleY('[data-hs-time-ruler="params"]'),
        filesBar: handleY('[data-hs-split-handle="files"]'),
        notesBar: handleY('[data-hs-split-handle="notes"]'),
    };
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`);

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p) => ({ id: p.id ?? 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const geo = () => cdp.call(inPageProbe);

    /**
     * 关掉任何**遗留的浮层**。
     *
     * 🔴 必做的前置（实测踩过）：手机档的顶栏菜单 / ∨ 工具菜单打开时会渲染一个
     * **`inset: 0` 的全屏透明按钮**当"点空白关闭"的遮罩（`MobileTopBar` /
     * `VMenuPanel`，`zIndex 29~40`）。它**盖住整个视口** ⇒ 之后所有触摸都落在它身上、
     * 拍数栏根本收不到 `pointerdown` ⇒ 读数是"边界纹丝不动、完全没有反应"，
     * 看起来像功能没实现。（取证：`document.elementsFromPoint` 第一层是
     * `BUTTON.fixed border-0 cursor-pointer|rect=0,0 360x731`。）
     */
    async function dismissOverlays() {
        const n = await cdp.call(() => {
            let closed = 0;
            for (const b of [...document.querySelectorAll('button')]) {
                const r = b.getBoundingClientRect();
                if (r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.95 && r.width > 0) {
                    b.click();
                    closed++;
                }
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return closed;
        });
        if (n > 0) console.log(`▸ 关掉 ${n} 个遗留全屏遮罩`);
        await sleep(500);
        return n;
    }

    /* 手机档：C5/C6 只在手机布局（`isPhone`）下生效。 */
    const g0 = await geo();
    console.log(`▸ 视口 ${g0.vw}×${g0.vh}  容器 top=${g0.container.top} h=${g0.container.h}`);
    if (!(g0.vw < 600)) {
        console.log('⚠️ 当前不是手机档视口（<600px），C5/C6 只在手机布局生效。');
    }

    /**
     * 设面板可见性。
     *
     * 🔴 **不走「视图」菜单**：手机档下那套 Radix 菜单用合成指针序列也打不开
     * （实测 `pops=0`，而 D3 那轮在平板档能开）。改用**应用自己的两个桥接事件**
     * —— 它们是面板 ✕ / 底栏切页真正在用的通道（`App.tsx` 里的消费方），
     * 确定性远好于模拟点菜单：
     *   · `hs-mobile-switch-tab` `{tab}`  ⇒ `showMobilePanel`（强制打开）
     *   · `hs-mobile-close-panel` `{key}` ⇒ `toggleMobilePanel`（关闭）
     * 顺序必须**先开需要的、再关不要的** —— `toggleMobilePanel` 有"至少保留一个"守卫。
     */
    async function setPanels(want) {
        await dismissOverlays();
        const fire = (name, detail) =>
            cdp.call(
                (n, d) => window.dispatchEvent(new CustomEvent(n, { detail: d })),
                name,
                detail,
            );
        for (const key of ['timeline', 'params', 'files', 'notes']) {
            if (want[key] && !(await geo()).panels[key]) {
                await fire('hs-mobile-switch-tab', { tab: key });
                await sleep(650);
            }
        }
        for (const key of ['timeline', 'params', 'files', 'notes']) {
            if (!want[key] && (await geo()).panels[key]) {
                await fire('hs-mobile-close-panel', { key });
                await sleep(650);
            }
        }
        await sleep(450);
        const g = await geo();
        const got = ['timeline', 'params', 'files', 'notes'].filter((k) => g.panels[k]).join('+');
        const exp = ['timeline', 'params', 'files', 'notes'].filter((k) => want[k]).join('+');
        if (got !== exp) throw new Error(`面板状态没设成：期望 ${exp}，实得 ${got}`);
        return g;
    }

    /**
     * 竖直拖动某个手柄。
     *
     * @param sel 手柄选择器。
     * @param toRatio 目标比值（手指最终停在容器内的归一化位置）；null = 只按 dy 相对移动。
     */
    async function dragHandle(sel, toRatio, dyFallback = 140) {
        await dismissOverlays();
        const g = await geo();
        const el = sel === 'params' ? g.paramsRuler : sel === 'files' ? g.filesBar : g.notesBar;
        if (!el) throw new Error(`找不到手柄 ${sel}`);
        const c = g.container;
        const toY = toRatio === null ? el.y + dyFallback : Math.round(c.top + toRatio * c.h);
        const steps = 6;
        await touch('touchStart', [{ id: 0, x: el.x, y: el.y }]);
        await sleep(60);
        for (let i = 1; i <= steps; i++) {
            await touch('touchMove', [{ id: 0, x: el.x, y: Math.round(el.y + ((toY - el.y) * i) / steps) }]);
            await sleep(45);
        }
        await sleep(120);
        const during = await geo();
        await touch('touchEnd', []);
        await sleep(900);
        return { during, after: await geo() };
    }

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };
    const panelsOf = (g) =>
        Object.entries(g.panels)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join('+') || '(无)';

    /* ── C5-1 全屏参数界面**下拉**同一根标题条 ⇒ 进入分屏 ───────────────── */
    {
        const before = await setPanels({ timeline: false, params: true, files: false, notes: false });
        const out = await dragHandle('params', 0.55);
        const ratio = out.after.ratio;
        check(
            'C5-1 全屏参数界面：下拉参数拍数栏 ⇒ 进入分屏（轨道 + 参数）',
            out.after.panels.timeline && out.after.panels.params && out.after.children === 2 &&
                ratio !== null && Math.abs(ratio - 0.55) <= 0.08,
            `前面板=${panelsOf(before)} → 后面板=${panelsOf(out.after)}  块数 ${before.children}→${out.after.children}  边界=${ratio}（期望≈0.55）`,
        );
    }

    /* ── C5-2 分屏下**向上**拖 ⇒ 轨道块变小 ─────────────────────────────── */
    {
        const before = await geo();
        const out = await dragHandle('params', 0.3);
        const ratio = out.after.ratio;
        check(
            'C5-2 分屏下向上拖参数拍数栏 ⇒ 边界上移（轨道块变小）',
            ratio !== null && Math.abs(ratio - 0.3) <= 0.08 && out.after.children === 2,
            `边界 ${before.ratio} → ${ratio}（期望≈0.30）  面板=${panelsOf(out.after)}  ${JSON.stringify(out.after.kids)}`,
        );
    }

    /* ── C6-1 拖到**很接近底部** ⇒ 下方面板太小 ⇒ 自动关闭 ⇒ 全屏轨道 ──── */
    {
        await setPanels({ timeline: true, params: true, files: false, notes: false });
        const out = await dragHandle('params', 0.95);
        check(
            'C6-1 边界拖到接近底部 ⇒ 参数面板自动关闭 ⇒ 全屏轨道',
            out.after.panels.timeline && !out.after.panels.params && out.after.children === 1,
            `面板=${panelsOf(out.after)}  块数=${out.after.children}  拖动末端 ratio=${out.during.ratio}`,
        );
    }

    /* ── C6-2 拖到**很接近顶部** ⇒ 轨道块太小 ⇒ 自动关闭轨道 ⇒ 全屏参数 ── */
    {
        await setPanels({ timeline: true, params: true, files: false, notes: false });
        const out = await dragHandle('params', 0.03);
        check(
            'C6-2 边界拖到接近顶部 ⇒ 轨道面板自动关闭 ⇒ 全屏参数',
            !out.after.panels.timeline && out.after.panels.params && out.after.children === 1,
            `面板=${panelsOf(out.after)}  块数=${out.after.children}  拖动末端 ratio=${out.during.ratio}`,
        );
    }

    /* ── C6-3 **文件浏览器标题栏**同样是手柄 ───────────────────────────── */
    {
        const before = await setPanels({ timeline: true, params: false, files: true, notes: false });
        const out = await dragHandle('files', 0.7);
        check(
            'C6-3 文件浏览器标题栏也能改边界（轨道 + 文件浏览器）',
            out.after.panels.timeline && out.after.panels.files && out.after.children === 2 &&
                out.after.ratio !== null && Math.abs(out.after.ratio - 0.7) <= 0.08,
            `前面板=${panelsOf(before)} → ${panelsOf(out.after)}  边界=${out.after.ratio}（期望≈0.70）`,
        );
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== C5/C6 探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
