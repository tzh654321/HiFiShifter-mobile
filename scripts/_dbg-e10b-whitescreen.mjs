#!/usr/bin/env node
/**
 * E10-② 复现：**用拖动「上工具栏」的方式反复切换「参数全屏 ⇄ 参数+轨道分屏」**，看参数界面会不会白屏。
 *
 * 用户口径（2026-09-30）：「使用拖动上工具栏的方式反复切换 参数界面全屏 与 参数+轨道分屏，
 * **10 次之内通常就能触发**参数界面的白屏」。
 *
 * 本脚本要同时回答三个问题（缺一不可，前两个测得出"坏了"，第三个才说得清"为什么坏"）：
 *  ① 界面坏没坏 —— 参数面板在不在 / opacity / `#root` 子节点数（**整页空的判据**）
 *  ② WebGL context 有没有被强制丢失 —— 逐 canvas `isContextLost()`
 *  ③ 为什么会坏 —— 页面内**统计 WebGL context 的真实创建次数**（`getContext` 包装 +
 *     WeakMap 去重），并记录未捕获异常、失败点被谁命中
 *
 * 【为什么必须数创建次数】"每页约 16 个 WebGL context"是硬上限，而 `isContextLost()`
 * 只在**已经超了**的时候才为真 —— 它测不出"每次挂载泄漏 3 个"这种趋势。数创建次数
 * 才能证明修复有效（修前：每轮 +N；修后：应稳定在常数）。
 *
 * 用法：node scripts/_dbg-e10b-whitescreen.mjs [serial] [rounds]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面内：装全套记录器（异常 / 根节点 / getContext 计数）。返回起始基线。 */
function inPageArm() {
    const w = window;
    if (w.__hsE10b) return { already: true };
    const st = {
        errors: [],
        rejections: [],
        ctxCreated: { webgl2: 0, webgl: 0, '2d': 0 },
        ctxNull: [],
        rootMin: Number.POSITIVE_INFINITY,
        startedAt: Date.now(),
    };
    w.__hsE10b = st;

    /* ① 未捕获异常 / 未处理 rejection：白屏的「直接原因」就在这里。 */
    w.addEventListener('error', (e) => {
        if (st.errors.length < 40) st.errors.push(String((e && e.message) || e) + ' @ ' + String((e && e.filename) || '').slice(-40));
    });
    w.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        if (st.rejections.length < 40) st.rejections.push(String((r && r.message) || r).slice(0, 160));
    });

    /* ② `getContext` 包装：数「真正新建」的 context 数（WeakMap 去重），
     *    并记录 null 返回（= 拿不到上下文的现场，白屏的根因现场）。 */
    /* 🔴 纪律：**健康检查绝不能自己调 `getContext`**。
     *
     * `getContext('webgl2')` 在一个**还没有任何 context** 的画布上会**创建**一个
     * WebGL context —— 于是"测量"本身就在吃那 8 个名额（甚至把本该是 2D 的
     * 候补画布变成 WebGL 画布）。实测这是**本探针早前把"分屏态 9 个 GL"
     * 报大了的直接原因**（那些 300x150、从未 rasterize 过的"GL 画布"里就有一部分是
     * 探针自己造出来的），也贡献了 logcat 里每轮 2 条 "Too many active WebGL contexts"。
     *
     * 正确做法：在 `getContext` 包装里把**已创建的** context 记下来（WeakMap，
     * 不进 DOM 也不阻止回收），健康检查只 `ctx.isContextLost()` —— 那是**只读**调用，
     * 不会创建任何东西。 */
    const orig = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakMap();
    /** canvas → { webgl2?: ctx, webgl?: ctx, '2d'?: ctx }（只存已存在的） */
    w.__hsCtxRegistry = new WeakMap();
    const registry = w.__hsCtxRegistry;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        let out = null;
        try {
            out = orig.call(this, type, ...rest);
        } catch (err) {
            out = null;
        }
        if (out !== null) {
            const key = String(type);
            let set = seen.get(this);
            if (!set) {
                set = new Set();
                seen.set(this, set);
            }
            let rec = registry.get(this);
            if (!rec) {
                rec = {};
                registry.set(this, rec);
            }
            rec[key] = out;
            if (!set.has(key)) {
                set.add(key);
                if (key in st.ctxCreated) st.ctxCreated[key] += 1;
            }
        } else if (String(type) in st.ctxCreated || type === 'webgl') {
            /* 失败现场：这个 canvas 上还有什么上下文（**只在失败时探测**，避免误建） */
            const had = [];
            for (const t of ['webgl2', 'webgl', '2d']) {
                try {
                    if (orig.call(this, t) !== null) had.push(t);
                } catch {
                    /* ignore */
                }
            }
            if (st.ctxNull.length < 20) {
                st.ctxNull.push({
                    type: String(type),
                    had: had.join('+') || '(none)',
                    inDom: this.isConnected ? 1 : 0,
                    attr: String(this.getAttribute('data-waveform-renderer') || '') +
                        (this.getAttribute('data-piano-roll-gl-scene') !== null ? '|glScene' : ''),
                    size: this.width + 'x' + this.height,
                });
            }
        }
        return out;
    };

    /* ③ 根节点存活：**"整页空"的判据**。记录历史最小值，漏一次也算。 */
    const root = document.getElementById('root');
    const sample = () => {
        const n = root ? root.children.length : -1;
        if (n < st.rootMin) st.rootMin = n;
    };
    sample();
    st.rootSampler = setInterval(sample, 120);
    if (root) {
        const mo = new MutationObserver(sample);
        mo.observe(root, { childList: true });
        st.rootObserver = mo;
    }
    return { already: false };
}

/** 页面内：读累计记录。 */
function inPageStats() {
    const st = window.__hsE10b || {};
    const canvas = document.querySelectorAll('canvas');
    return {
        errors: st.errors || [],
        rejections: st.rejections || [],
        ctxCreated: st.ctxCreated || null,
        ctxNull: st.ctxNull || [],
        rootMin: st.rootMin === undefined ? null : st.rootMin,
    };
}

/** 页面内：健康度快照。 */
function inPageHealth() {
    const pane = document.querySelector('[data-hs-pane="params"]');
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    const canvas = document.querySelectorAll('canvas');
    const root = document.getElementById('root');
    return {
        pane: !!pane,
        paneH: paneRect ? Math.round(paneRect.height) : null,
        paneOpacity: pane ? +(+getComputedStyle(pane).opacity).toFixed(2) : null,
        canvases: canvas.length,
        /* E10-② 第③步「降 context 数」的**直读判据**：参数面板内的 canvas 数。
           overlay（播放头/选区）由独立 GL 画布改为复用主 GL 画布后，这里应比改前少 1。
           用 DOM 计数而不是数 context —— 因为 `getContext` 包装若晚于 context 创建，
           WeakMap 里就没有那条记录（`gl.none` 会虚高），DOM 计数不受影响。 */
        paneCanvases: pane ? pane.querySelectorAll('canvas').length : null,
        /* E10-② 的关键健康指标：**每个 WebGL context 是否已被强制丢失**。
           （DOM 在不在、opacity 是不是 1 都测不出白屏 —— 白屏是"canvas 在、画不出东西"。）
           ⚠️ 只用**已记录**的 context（`window.__hsCtxRegistry`），**不调 getContext**
           —— 否则测量本身会创建 context（见 `inPageArm` 里的纪律说明）。 */
        gl: (() => {
            const reg = window.__hsCtxRegistry;
            const acc = { ok: 0, lost: 0, none: 0 };
            for (const c of canvas) {
                const rec = reg ? reg.get(c) : null;
                const ctx = rec ? rec.webgl2 || rec.webgl : null;
                if (!ctx) acc.none++;
                else if (ctx.isContextLost()) acc.lost++;
                else acc.ok++;
            }
            return acc;
        })(),
        /* 「整页空」判据：`#root` 还在不在、还有没有子节点。 */
        root: root ? root.children.length : -1,
        boundary: !!document.querySelector('[aria-label="error-detail"]'),
        paramVp: typeof window.__hsParamViewport === 'function',
        viewport: typeof window.__hsViewport === 'function',
        bodyLen: (document.body.innerText || '').length,
        kernelUnavailable: /内核不可用|无法渲染|渲染失败/.test(document.body.innerText || ''),
        handle: !!document.querySelector('[data-hs-split-handle]'),
        splitKids: (document.querySelector('[data-hs-mobile-split]') || { children: [] }).children.length,
    };
}

/** 页面内：手柄位置与容器几何。 */
function inPageHandle() {
    const h = document.querySelector('[data-hs-split-handle]');
    const cont = document.querySelector('[data-hs-mobile-split]');
    if (!h || !cont) return { error: 'no-handle-or-container' };
    const hr = h.getBoundingClientRect();
    const cr = cont.getBoundingClientRect();
    return {
        handle: { x: Math.round(hr.left + hr.width / 2), y: Math.round(hr.top + hr.height / 2) },
        container: { top: Math.round(cr.top), h: Math.round(cr.height), left: Math.round(cr.left), w: Math.round(cr.width) },
    };
}

async function main() {
    const serial = process.argv[2] || 'emulator-5554';
    const rounds = Number(process.argv[3] || 15);
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    /* logcat 清空，跑完再 dump（含 chromium / 崩溃 / GL） */
    try {
        execSync(`adb -s ${serial} logcat -c`);
    } catch {
        /* ignore */
    }

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    /** 拖手柄到容器内的目标比例（0=顶, 1=底）。 */
    async function dragHandleTo(ratio) {
        const g = await cdp.call(inPageHandle);
        if (g.error) return g;
        const y0 = g.handle.y;
        const y1 = Math.round(g.container.top + g.container.h * ratio);
        const x = g.handle.x;
        await touch('touchStart', [{ x, y: y0 }]);
        await sleep(90);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [{ x, y: Math.round(y0 + ((y1 - y0) * i) / 6) }]);
            await sleep(70);
        }
        await touch('touchEnd', []);
        await sleep(650);
        return { from: y0, to: y1 };
    }
    /** 用桥接事件把两个面板都恢复出来（保证下一轮手柄存在）。 */
    async function ensureSplit() {
        await cdp.call(() => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
            return true;
        });
        await sleep(900);
    }

    const armed = await cdp.call(inPageArm);
    console.log('▸ 记录器：' + JSON.stringify(armed));

    await ensureSplit();
    let h = await cdp.call(inPageHealth);
    const s0 = await cdp.call(inPageStats);
    console.log('▸ 起始：' + JSON.stringify(h));
    console.log('▸ 起始 context 累计创建：' + JSON.stringify(s0.ctxCreated));
    if (!h.pane || !h.handle) throw new Error('前置不满足：需要"参数 + 轨道"分屏且手柄在');

    let broke = 0;
    let maxLost = 0;
    const perRound = [];
    for (let i = 1; i <= rounds; i++) {
        await dragHandleTo(0.92); // ⇒ 轨道被挤掉 = 参数全屏
        let a = null;
        try {
            a = await cdp.call(inPageHealth);
        } catch (e) {
            a = { error: String(e).slice(0, 80) };
        }
        await ensureSplit(); // 回到分屏，好让下一次还能拖
        let b = null;
        try {
            b = await cdp.call(inPageHealth);
        } catch (e) {
            b = { error: String(e).slice(0, 80) };
        }
        const st = await cdp.call(inPageStats);
        const bad =
            a.error ||
            b.error ||
            (a.pane && a.paneOpacity === 0) ||
            a.kernelUnavailable ||
            a.root === 0 ||
            b.root === 0 ||
            a.boundary ||
            b.boundary;
        if (bad) broke++;
        /* ⚠️ 不因为"context 被丢失"就提前退出：要看到**丢失之后能不能自愈**
           （这正是本次修法的关键 —— 强制丢失不可避免，但不该是永久白屏）。 */
        perRound.push(st.ctxCreated ? st.ctxCreated.webgl2 : -1);
        console.log(
            `  第 ${i} 轮：全屏[root=${a.root} canvas=${a.canvases} 面板canvas=${a.paneCanvases} gl=${JSON.stringify(a.gl)}]` +
                ` 分屏[root=${b.root} canvas=${b.canvases} 面板canvas=${b.paneCanvases} gl=${JSON.stringify(b.gl)}]` +
                ` 累计GL创建=${st.ctxCreated ? st.ctxCreated.webgl2 : '?'}` +
                ` 错误=${st.errors.length} 拒绝=${st.rejections.length}${bad ? '  🔴页面异常' : ''}`,
        );
        maxLost = Math.max(maxLost, (a.gl ? a.gl.lost : 0) + (b.gl ? b.gl.lost : 0));
        if (bad) break;
    }

    /* ── 自愈判据（E10-② 的核心验收）────────────────────────────────────────
     * 被强制丢失的 context 在**旧实现**里是**永久**的（内核不处理 restored，
     * program 已失效且无人重建 ⇒ 面板永久空白 = 用户报的白屏）。
     * 新实现：丢失 → 浏览器恢复 → 广播 `hs-gl-restored` → App 换 key 重挂面板 ⇒ 内核重建。
     * 所以这里给恢复留 4 秒，再看**分屏态是否还残留 lost 画布**。 */
    await ensureSplit();
    await sleep(4000);
    const healed = await cdp.call(inPageHealth);
    const healedSplit = await cdp.call(() => {
        const reg = window.__hsCtxRegistry;
        const acc = { ok: 0, lost: 0, none: 0 };
        for (const c of document.querySelectorAll('canvas')) {
            const rec = reg ? reg.get(c) : null;
            const ctx = rec ? rec.webgl2 || rec.webgl : null;
            if (!ctx) acc.none++;
            else if (ctx.isContextLost()) acc.lost++;
            else acc.ok++;
        }
        return {
            g: acc,
            root: document.getElementById('root').children.length,
            boundary: !!document.querySelector('[aria-label="error-detail"]'),
        };
    });
    console.log(
        `\n自愈检查（循环结束 +4s，分屏态）：gl=${JSON.stringify(healedSplit.g)}` +
            ` root=${healedSplit.root} 错误边界=${healedSplit.boundary} 参数面板=${healed.pane}`,
    );

    const sN = await cdp.call(inPageStats);
    console.log(`\n轮次：${rounds}（每轮 = 拖到参数全屏 → 桥接恢复分屏）  页面异常轮=${broke}  单轮最多丢失 context=${maxLost}`);
    console.log(`累计 WebGL 创建：起 ${JSON.stringify(s0.ctxCreated)} → 末 ${JSON.stringify(sN.ctxCreated)}`);
    console.log(`每轮结束时的累计 webgl2 创建数：${JSON.stringify(perRound)}`);
    console.log(`#root 子节点历史最小值：${sN.rootMin}（0 = 出现过"整页空"）`);
    console.log(`\n未捕获异常（${sN.errors.length}）：`);
    for (const e of sN.errors.slice(0, 8)) console.log('  ✗ ' + e);
    console.log(`未处理 rejection（${sN.rejections.length}）：`);
    for (const r of sN.rejections.slice(0, 6)) console.log('  ✗ ' + r);
    console.log(`getContext 失败现场（${sN.ctxNull.length}）：`);
    for (const c of sN.ctxNull.slice(0, 6)) console.log('  ✗ ' + JSON.stringify(c));

    const log = execSync(`adb -s ${serial} logcat -d -t 1500`, { maxBuffer: 32 * 1024 * 1024 })
        .toString()
        .split('\n')
        .filter((l) => /Too many active WebGL|chromium|RenderProcessGone|SIGSEGV|Context Lost|hifishifter.*(died|crash)|gralloc/i.test(l));
    const tooMany = log.filter((l) => /Too many active WebGL/.test(l)).length;
    const verdict = [
        ['页面全程未整页空（#root 子节点最小值 > 0）', sN.rootMin !== null && sN.rootMin > 0],
        ['无未捕获异常（排除 ResizeObserver 噪音）', sN.errors.filter((e) => !/ResizeObserver/.test(e)).length === 0],
        ['无未处理 rejection', sN.rejections.length === 0],
        ['未出现错误边界（说明没有渲染期抛错）', !healedSplit.boundary],
        ['结束后**不残留被丢失的 context**（自愈生效）', healedSplit.g.lost === 0],
    ];
    console.log('\n判据：');
    let ok = 0;
    for (const [name, v] of verdict) {
        console.log(`  ${v ? '✅' : '❌'} ${name}`);
        if (v) ok++;
    }
    console.log(`  通过 ${ok} / ${verdict.length}`);
    console.log(`\nlogcat："Too many active WebGL contexts" ×${tooMany}；命中总行数 ${log.length}`);
    for (const l of log.slice(-12)) console.log('  ' + l.slice(0, 190));
    cdp.close();
}

await main();
