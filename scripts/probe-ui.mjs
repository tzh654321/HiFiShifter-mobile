#!/usr/bin/env node
/**
 * UI 基线探针 —— 把「手机界面手感」问题变成可复跑的量测（用户 2026-09-19 清单）。
 *
 * 用法（先装好 debug APK 并置于前台）：
 *   node scripts/probe-ui.mjs --serial emulator-5554 dump        # 底栏按钮：尺寸/配色/图标
 *   node scripts/probe-ui.mjs --serial emulator-5554 fold        # ∧ 浮层内容
 *   node scripts/probe-ui.mjs --serial emulator-5554 eye         # 👁 浮层内容
 *   node scripts/probe-ui.mjs --serial emulator-5554 rulers      # 滚条 thumb 拖拽（是否中途被取消）
 *   node scripts/probe-ui.mjs --serial emulator-5554 one         # 单指划动：画布/拍数栏/琴键轴 方向
 *   node scripts/probe-ui.mjs --serial emulator-5554 two         # 双指：画布内 / 跨区（一拍数栏+画布）
 *   node scripts/probe-ui.mjs --serial emulator-5554 tab <轨道|参数>
 *
 * 坐标一律 CSS px、相对 WebView 视口（与 layout-audit.mjs 的 rect 同域）。
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', host: '127.0.0.1', port: 9222, steps: 10 };
    const rest = [];
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--host') o.host = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--steps') o.steps = Number(argv[++i]);
        else rest.push(a);
    }
    o.cmd = rest[0];
    o.arg = rest[1];
    return o;
}

async function fwd(serial) {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用未运行（pidof 空）');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();
    return pid;
}

/* ── 页面内助手（序列化后注入）────────────────────────────────────────── */

function ipDump() {
    const rect = (e) => {
        const r = e.getBoundingClientRect();
        return [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    };
    const desc = (e) => {
        const svg = e.querySelector('svg');
        let shape = null;
        if (svg) {
            const vb = svg.getAttribute('viewBox');
            shape = {
                viewBox: vb,
                n: svg.querySelectorAll('path,rect,circle,line,polygon').length,
                // 右下角小三角（原版绘制工具的角标）：路径近似 M0 6L6 0V6Z
                tri: [...svg.querySelectorAll('path')].some((p) => /^M0\s*6\s*L6\s*0\s*V6\s*Z$/i.test((p.getAttribute('d') || '').trim())),
                // 角标可能不在 svg 里，而是在按钮内另一个绝对定位的小 svg（如 PianoRollPanel 的 6×6）
                triAny: [...e.querySelectorAll('svg')].some((s) => {
                    const r = s.getBoundingClientRect();
                    return r.width <= 9 && r.height <= 9 && s.querySelectorAll('path').length > 0;
                }),
            };
        }
        return shape;
    };
    const bar = [...document.querySelectorAll('[role="toolbar"]')].find((e) => /底部工具条/.test(e.getAttribute('aria-label') || ''));
    const out = { bar: null, items: [], popovers: [] };
    if (bar) {
        out.bar = { rect: rect(bar), bg: getComputedStyle(bar).backgroundColor };
        out.items = [...bar.querySelectorAll('button')].map((b) => {
            const c = getComputedStyle(b);
            return {
                label: b.getAttribute('aria-label'),
                pressed: b.getAttribute('aria-pressed'),
                expanded: b.getAttribute('aria-expanded'),
                rect: rect(b),
                bg: c.backgroundColor,
                color: c.color,
                radius: c.borderRadius,
                shape: desc(b),
                // 视觉盒子（.hs-bar-vis：28px 内盒，配色/尺寸都看它）
                visual: (() => {
                    const cand = b.querySelector('.hs-bar-vis');
                    if (!cand) return null;
                    const cc = getComputedStyle(cand);
                    return {
                        rect: rect(cand),
                        bg: cc.backgroundColor,
                        color: cc.color,
                        radius: cc.borderRadius,
                    };
                })(),
            };
        });
    }
    // 可见的浮层（∧ / 👁 / 绘制工具）：面板本身带 aria-label 且内含 ≥2 个按钮
    out.popovers = ['更多开关', '参数与覆盖层', '绘制工具']
        .map((name) =>
            [...document.querySelectorAll(`[aria-label="${name}"]`)].find(
                (e) => e.querySelectorAll('button').length >= 2,
            ),
        )
        .filter((e) => e && e.offsetParent !== null)
        .map((e) => ({
            name: e.getAttribute('aria-label'),
            rect: rect(e),
            items: [...e.querySelectorAll('button')].map((b) => ({
                t: (b.textContent || '').trim().slice(0, 12),
                on: b.getAttribute('aria-pressed'),
            })),
        }));
    // 手势容器（0014/0018 会给待接管元素设 touchAction=none）
    out.gestureTargets = [...document.querySelectorAll('*')]
        .filter((e) => e.style && e.style.touchAction === 'none')
        .map((e) => ({ rect: rect(e), cls: String(e.className || '').slice(0, 46), tag: e.tagName }));
    // 参数面板状态量
    const sc = document.querySelector('[data-piano-roll-scroller]');
    out.paramScroller = sc ? { rect: rect(sc), scrollLeft: +sc.scrollLeft.toFixed(1), scrollTop: +sc.scrollTop.toFixed(1) } : null;
    out.hooks = {
        gestureAttached: window.__hsParamGestureAttached ?? null,
        overlayVisible: window.__hsOverlaysVisible ?? null,
        viewport: typeof window.__hsViewport === 'function' ? window.__hsViewport() : null,
    };
    // 标尺刻度（拍数标签）位置 —— 横向平移/缩放的直接观测量
    const ticks = [...document.querySelectorAll('div')]
        .filter((e) => e.children.length === 0 && /^\d+\.\d+$/.test((e.textContent || '').trim()))
        .map((e) => ({ t: e.textContent.trim(), x: +e.getBoundingClientRect().left.toFixed(1), y: +e.getBoundingClientRect().top.toFixed(1) }))
        .filter((t) => t.x > -20 && t.x < window.innerWidth + 20);
    out.ticks = ticks.slice(0, 8);
    out.vp = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
    return out;
}

function ipScrollbarProbe() {
    // 自绘滚动条：thumb 是 track 内的绝对定位子元素
    const out = { tracks: [] };
    const sc = document.querySelector('[data-piano-roll-scroller]');
    if (!sc) return out;
    const pr = sc.getBoundingClientRect();
    // 按几何找 8px 厚的长条（自绘滚动条 track）
    const pr0 = sc.getBoundingClientRect();
    const cands = [...document.querySelectorAll('div')].filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.top < pr0.top - 40 || r.bottom > pr0.bottom + 40) return false;
        const vbar = r.width <= 12 && r.height > 80;
        const hbar = r.height <= 12 && r.width > 80;
        return vbar || hbar;
    });
    out.tracks = cands.slice(0, 4).map((t) => {
        const r = t.getBoundingClientRect();
        const th = t.firstElementChild;
        const tr = th ? th.getBoundingClientRect() : null;
        return {
            rect: [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
            cls: String(t.className).slice(0, 30),
            thumb: tr ? [+tr.left.toFixed(1), +tr.top.toFixed(1), +tr.width.toFixed(1), +tr.height.toFixed(1)] : null,
            thumbTouchAction: th ? getComputedStyle(th).touchAction : null,
            trackTouchAction: getComputedStyle(t).touchAction,
        };
    });
    out.scrollerTouchAction = getComputedStyle(sc).touchAction;
    out.chain = (() => {
        let e = sc, chain = [];
        while (e && chain.length < 6) {
            chain.push(e.tagName.toLowerCase() + '.' + String(e.className || '').split(/\s+/)[0] + ':' + getComputedStyle(e).touchAction);
            e = e.parentElement;
        }
        return chain;
    })();
    return out;
}

/* ── CDP 驱动 ─────────────────────────────────────────────────────────── */

async function main() {
    const o = parseArgs(process.argv);
    await fwd(o.serial);
    const cdp = await Cdp.attach({ host: o.host, port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch { /* ignore */ }

    const call = (fn, ...args) => cdp.call(fn, ...args);
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    async function tap(x, y, hold = 60) {
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(220);
    }

    /** 单指划动：n 步插值 */
    async function drag1(x1, y1, x2, y2, ms = 500) {
        await touch('touchStart', [{ x: x1, y: y1 }]);
        const n = Math.max(3, o.steps);
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            await touch('touchMove', [{ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }]);
            await sleep(ms / n);
        }
        await touch('touchEnd', []);
        await sleep(300);
    }

    /** 双指：落指顺序 = p1 → p1+p2 → 同步 move → 抬起 */
    async function drag2(p1a, p2a, p1b, p2b, ms = 600) {
        await touch('touchStart', [{ id: 0, x: p1a.x, y: p1a.y }]);
        await sleep(40);
        await touch('touchStart', [{ id: 0, x: p1a.x, y: p1a.y }, { id: 1, x: p2a.x, y: p2a.y }]);
        const n = Math.max(4, o.steps);
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            await touch('touchMove', [
                { id: 0, x: p1a.x + (p1b.x - p1a.x) * t, y: p1a.y + (p1b.y - p1a.y) * t },
                { id: 1, x: p2a.x + (p2b.x - p2a.x) * t, y: p2a.y + (p2b.y - p2a.y) * t },
            ]);
            await sleep(ms / n);
        }
        await touch('touchEnd', []);
        await sleep(400);
    }

    const state = () => call(ipDump);
    const pv = () => call(() => (window.__hsParamViewport ? window.__hsParamViewport() : null));
    const brief = (s) => {
        const v = s.hooks.viewport;
        return {
            scrollLeft: s.paramScroller ? s.paramScroller.scrollLeft : null,
            scrollTop: s.paramScroller ? s.paramScroller.scrollTop : null,
            pxPerSec: v ? +v.pxPerSec.toFixed(3) : null,
            rh: v ? +v.rowHeight.toFixed(3) : null,
            tick0: s.ticks.length ? `${s.ticks[0].t}@${s.ticks[0].x}` : null,
            tickN: s.ticks.length ? `${s.ticks[s.ticks.length - 1].t}@${s.ticks[s.ticks.length - 1].x}` : null,
            nTicks: s.ticks.length,
        };
    };
    /** 参数面板真值（__hsParamViewport）：断言方向/幅度用。 */
    const briefP = async () => {
        const v = await pv();
        if (!v) return { missing: true };
        return {
            pxPerSec: +v.pxPerSec.toFixed(2),
            scrollLeft: +v.scrollLeft.toFixed(1),
            span: +v.span.toFixed(4),
            center: +v.center.toFixed(4),
            rowHeight: +v.rowHeight.toFixed(3),
            h: v.viewportHeight,
        };
    };
    const diffP = (a, b, keys) => {
        const out = {};
        for (const k of keys) {
            out[k] = `${a[k]} → ${b[k]} (Δ${(b[k] - a[k]).toFixed(3)})`;
        }
        return out;
    };

    const c = o.cmd || 'dump';

    if (c === 'dump' || c === 'state') {
        const s = await state();
        console.log(JSON.stringify(s, null, 1));
        return cdp.close();
    }

    if (c === 'pop') {
        const s = await state();
        console.log('popovers:', JSON.stringify(s.popovers, null, 1));
        return cdp.close();
    }

    if (c === 'fold' || c === 'eye') {
        const s0 = await state();
        const want = c === 'fold' ? /更多开关/ : /参数与覆盖层/;
        const b = s0.items.find((it) => want.test(it.label || ''));
        if (!b) {
            console.log(`❌ 底栏没有匹配 ${want} 的按钮；现有:`, s0.items.map((i) => i.label));
            return cdp.close();
        }
        const x = b.rect[0] + b.rect[2] / 2;
        const y = b.rect[1] + b.rect[3] / 2;
        await tap(x, y);
        const s1 = await state();
        console.log(`按钮 ${b.label} @(${x},${y}) → 浮层:`, JSON.stringify(s1.popovers, null, 1));
        return cdp.close();
    }

    if (c === 'feat') {
        // 结构断言：① 铅笔右下角三角 ② ∧ 浮层 10 项 ③ 👁 浮层内容 ④ 铅笔子菜单 2 项
        const s0 = await state();
        const corner = await call(() => {
            const c = document.querySelector('[data-hs-draw-corner]');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            const btn = c.closest('button');
            const br = btn ? btn.getBoundingClientRect() : null;
            return {
                rect: [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
                atBottomRight: br
                    ? r.right >= br.right - 6 && r.bottom >= br.bottom - 6
                    : null,
                d: c.querySelector('path') ? c.querySelector('path').getAttribute('d') : null,
            };
        });
        console.log('① 笔右下角三角:', JSON.stringify(corner));

        const fold = s0.items.find((i) => i.label === '更多开关');
        if (fold) {
            await tap(fold.rect[0] + fold.rect[2] / 2, fold.rect[1] + fold.rect[3] / 2);
            const p = (await state()).popovers.find((x) => x.name === '更多开关');
            console.log('② ∧ 浮层:', p ? `${p.items.length} 项: ` + p.items.map((i) => i.t).join('/') : '未打开');
            await tap(10, 400); // 点浮层外关闭
        }

        const eye = s0.items.find((i) => i.label === '参数与覆盖层');
        if (eye) {
            await tap(eye.rect[0] + eye.rect[2] / 2, eye.rect[1] + eye.rect[3] / 2);
            const p = (await state()).popovers.find((x) => x.name === '参数与覆盖层');
            console.log('③ 👁 浮层:', p ? `${p.items.length} 项: ` + p.items.map((i) => `${i.t}${i.on === 'true' ? '*' : ''}`).join('/') : '未打开');
            await tap(10, 400);
        }

        const pencil = s0.items.find((i) => i.label === '绘制');
        if (pencil && corner) {
            // 点右下角命中区（按钮右下 6px 内）
            await tap(pencil.rect[0] + pencil.rect[2] - 4, pencil.rect[1] + pencil.rect[3] - 4);
            const p = (await state()).popovers.find((x) => x.name === '绘制工具');
            console.log('④ 铅笔子菜单（点三角）:', p ? `${p.items.length} 项: ` + p.items.map((i) => i.t).join('/') : '未打开');
        }
        return cdp.close();
    }

    if (c === 'rulers' || c === 'scrollbars') {
        console.log('滚动条几何:', JSON.stringify(await call(ipScrollbarProbe), null, 1));
        return cdp.close();
    }

    if (c === 'tab') {
        const s0 = await state();
        // 页签在 nav[aria-label=主面板切换] 内
        const res = await cdp.call((name) => {
            const nav = document.querySelector('nav[aria-label="主面板切换"]');
            if (!nav) return 'no-nav';
            const b = [...nav.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes(name));
            if (!b) return 'no-btn:' + [...nav.querySelectorAll('button')].map((x) => x.textContent.trim()).join('|');
            b.click();
            return 'ok';
        }, o.arg || '参数');
        await sleep(600);
        console.log('切换页签:', res, '→', JSON.stringify(brief(await state())));
        return cdp.close();
    }

    if (c === 'one') {
        const s0 = await state();
        const gt = s0.gestureTargets;
        console.log('手势容器:', JSON.stringify(gt.map((g) => [g.cls.slice(0, 30), g.rect])));
        console.log('起点:', JSON.stringify(await briefP()));

        // ① 拍数栏：左划 100px（内容跟手 ⇒ scrollLeft 应减 100）
        const ruler = gt.find((g) => g.rect[3] < 60 && g.rect[2] > 100);
        if (ruler) {
            const y = ruler.rect[1] + ruler.rect[3] / 2;
            const x1 = ruler.rect[0] + ruler.rect[2] * 0.75;
            const a = await briefP();
            await drag1(x1, y, x1 - 100, y);
            const b = await briefP();
            console.log(`拍数栏 左划100px @y=${y.toFixed(1)} →`, JSON.stringify(diffP(a, b, ['scrollLeft', 'pxPerSec'])), '期望 ΔscrollLeft≈+100（内容跟手：手指左划=看到更后面的内容）');
        } else {
            console.log('❌ 未定位到拍数栏手势容器');
        }

        // ② 琴键轴：上划 100px（内容跟手 ⇒ center 减 100/rowHeight）
        const axis = gt.find((g) => g.rect[2] < 90 && g.rect[3] > 150);
        if (axis) {
            const x = axis.rect[0] + axis.rect[2] / 2;
            const y1 = axis.rect[1] + axis.rect[3] * 0.5;
            const a = await briefP();
            await drag1(x, y1, x, y1 - 100);
            const b = await briefP();
            const exp = -100 / a.rowHeight;
            console.log(`琴键轴 上划100px @x=${x.toFixed(1)} →`, JSON.stringify(diffP(a, b, ['center', 'span'])), `期望 Δcenter≈${exp.toFixed(3)}`);
        } else {
            console.log('❌ 未定位到琴键轴手势容器');
        }

        // ③ 画布单指（绘制模式=绘制，设计上不平移）
        const sc = s0.paramScroller;
        if (sc) {
            const x = sc.rect[0] + sc.rect[2] * 0.6;
            const y1 = sc.rect[1] + sc.rect[3] * 0.5;
            const a = await briefP();
            await drag1(x, y1, x, y1 - 120);
            const b = await briefP();
            console.log(`画布 单指上划120px →`, JSON.stringify(diffP(a, b, ['scrollLeft', 'center'])), '（设计上单指=绘制/框选，不平移）');
        }
        return cdp.close();
    }

    if (c === 'diag') {
        // 在文档捕获阶段记录指针事件落在谁身上（不改 APK，运行时注入）
        await call(() => {
            const log = [];
            window.__hsDiag = log;
            const desc = (e) =>
                e
                    ? e.tagName.toLowerCase() +
                      '.' +
                      String(e.className || '').toString().split(/\s+/)[0] +
                      (e.getAttribute && e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : '')
                    : 'null';
            for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
                document.addEventListener(
                    t,
                    (ev) => {
                        if (t === 'pointermove' && log.length > 60) return;
                        log.push(`${t} id=${ev.pointerId} type=${ev.pointerType} @(${Math.round(ev.clientX)},${Math.round(ev.clientY)}) → ${desc(ev.target)}`);
                    },
                    true,
                );
            }
            return true;
        });
        const s0 = await state();
        const sc = s0.paramScroller;
        const gt = s0.gestureTargets;
        const ruler = gt.find((g) => g.rect[3] < 60 && g.rect[2] > 100);
        const cx = sc.rect[0] + sc.rect[2] / 2;
        const cy = sc.rect[1] + sc.rect[3] / 2;
        const ry = ruler.rect[1] + ruler.rect[3] / 2;
        // 运行时给「当前」拍数栏元素挂一个探针监听，验证它到底收不收得到事件
        const probe = await call(
            (r) => {
                const el = [...document.querySelectorAll('div')].find((e) => {
                    const b = e.getBoundingClientRect();
                    return (
                        Math.abs(b.left - r[0]) < 2 &&
                        Math.abs(b.top - r[1]) < 2 &&
                        Math.abs(b.width - r[2]) < 2 &&
                        Math.abs(b.height - r[3]) < 2
                    );
                });
                if (!el) return 'not-found';
                window.__hsRulerProbe = 0;
                el.addEventListener('pointerdown', () => {
                    window.__hsRulerProbe += 1;
                });
                return `attached:${String(el.className).slice(0, 24)}`;
            },
            ruler.rect,
        );
        console.log('探针:', probe);
        // 合成事件计数：controller 在「第二指落下」时会派发 window 级合成
        // pointercancel/pointerup（isTrusted=false）。计数为 0 ⇒ 它根本没看到第一指。
        await call(() => {
            window.__hsAbort = 0;
            window.addEventListener('pointerup', (ev) => {
                if (!ev.isTrusted) window.__hsAbort += 1;
            });
            window.addEventListener('pointercancel', (ev) => {
                if (!ev.isTrusted) window.__hsAbort += 1;
            });
            return true;
        });
        const useAxis = process.env.HS_AXIS === '1';
        const axisEl = gt.find((g) => g.rect[2] < 90 && g.rect[3] > 150);
        const p1 = useAxis ? { x: axisEl.rect[0] + axisEl.rect[2] / 2, y: cy - 20 } : { x: cx - 20, y: ry };
        const p1b = useAxis ? { x: axisEl.rect[0] + axisEl.rect[2] / 2 + 60, y: cy - 20 } : { x: cx + 10, y: ry };
        await touch('touchStart', [{ id: 0, x: p1.x, y: p1.y }]);
        await sleep(60);
        await touch('touchStart', [{ id: 0, x: p1.x, y: p1.y }, { id: 1, x: cx + 40, y: cy }]);
        await sleep(60);
        await touch('touchMove', [{ id: 0, x: p1b.x, y: p1b.y }, { id: 1, x: cx + 70, y: cy }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(200);
        const log = await call(() => window.__hsDiag || []);
        const hits = await call(() => window.__hsRulerProbe);
        const aborts = await call(() => window.__hsAbort);
        console.log('拍数栏→画布 事件轨迹（探针命中 ' + hits + ' 次, controller 合成中止 ' + aborts + ' 次）:');
        for (const l of log) console.log('  ' + l);
        return cdp.close();
    }

    if (c === 'cross') {
        // 诊断：跨区双指为什么不动 —— 逐段落检查手势会话是否建立
        const s0 = await state();
        const sc = s0.paramScroller;
        const gt = s0.gestureTargets;
        if (!sc) {
            console.log('❌ 不在参数页签');
            return cdp.close();
        }
        const cx = sc.rect[0] + sc.rect[2] / 2;
        const cy = sc.rect[1] + sc.rect[3] / 2;
        const ruler = gt.find((g) => g.rect[3] < 60 && g.rect[2] > 100);
        const axis = gt.find((g) => g.rect[2] < 90 && g.rect[3] > 150);
        const flag = () => call(() => ({
            active: window.__hsGestureActive ?? null,
            sl: window.__hsParamViewport ? +window.__hsParamViewport().scrollLeft.toFixed(1) : null,
        }));

        const variants = [
            ['拍数栏→画布', ruler ? { x: cx - 20, y: ruler.rect[1] + ruler.rect[3] / 2 } : null, { x: cx + 40, y: cy }],
            ['画布→拍数栏', { x: cx - 20, y: cy }, ruler ? { x: cx + 40, y: ruler.rect[1] + ruler.rect[3] / 2 } : null],
            ['琴键轴→画布', axis ? { x: axis.rect[0] + axis.rect[2] / 2, y: cy - 20 } : null, { x: cx + 40, y: cy }],
            ['画布内(对照)', { x: cx - 20, y: cy }, { x: cx + 40, y: cy + 20 }],
        ];
        for (const [name, a, b] of variants) {
            if (!a || !b) {
                console.log(`${name}: 跳过（未定位到区域）`);
                continue;
            }
            const before = await flag();
            await touch('touchStart', [{ id: 0, x: a.x, y: a.y }]);
            await sleep(60);
            const mid1 = await flag();
            await touch('touchStart', [{ id: 0, x: a.x, y: a.y }, { id: 1, x: b.x, y: b.y }]);
            await sleep(60);
            const mid2 = await flag();
            // 左移：内容跟手 ⇒ scrollLeft 增大，不会被左边界钳成 0（右移则可能被钳）
            for (let i = 1; i <= 6; i++) {
                await touch('touchMove', [
                    { id: 0, x: a.x - i * 10, y: a.y },
                    { id: 1, x: b.x - i * 10, y: b.y },
                ]);
                await sleep(30);
            }
            const mid3 = await flag();
            await touch('touchEnd', []);
            await sleep(300);
            const after = await flag();
            console.log(
                `${name}: 一指${before.active}/${before.sl} → 两指${mid1.active} → 会话${mid2.active} → 拖动中${mid3.active}/${mid3.sl} → 抬起${after.sl} (Δ${(after.sl - before.sl).toFixed(1)}, 期望 +60)`,
            );
        }
        return cdp.close();
    }

    if (c === 'tl') {
        const gt = (await state()).gestureTargets;
        console.log('手势容器:', JSON.stringify(gt.map((g) => [g.cls.slice(0, 30), g.rect])));
        const vp = () => call(() => (window.__hsViewport ? window.__hsViewport() : null));
        const v0 = await vp();
        if (!v0) {
            console.log('❌ 时间线 __hsViewport 不存在（当前不在轨道页签？）');
            return cdp.close();
        }
        console.log('起点:', JSON.stringify({ pxPerSec: +v0.pxPerSec.toFixed(2), scrollLeft: +v0.scrollLeft.toFixed(1), rowHeight: +v0.rowHeight.toFixed(2) }));
        const r = v0.containerRect;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // 双指左移 60px：内容跟手 ⇒ scrollLeft +60（左边界处不会像右移那样被钳）
        await drag2({ x: cx + 30, y: cy }, { x: cx + 90, y: cy }, { x: cx - 30, y: cy }, { x: cx + 30, y: cy });
        const v1 = await vp();
        console.log(`时间线 双指左移60 → scrollLeft ${v0.scrollLeft.toFixed(1)} → ${v1.scrollLeft.toFixed(1)} (Δ${(v1.scrollLeft - v0.scrollLeft).toFixed(1)}, 期望 +60)`);
        // 双指张开：pxPerSec 应增大
        await drag2({ x: cx - 30, y: cy }, { x: cx + 30, y: cy }, { x: cx - 80, y: cy }, { x: cx + 80, y: cy });
        const v2 = await vp();
        console.log(`时间线 双指张开60→160 → pxPerSec ${v1.pxPerSec.toFixed(1)} → ${v2.pxPerSec.toFixed(1)} (期望增大)`);
        return cdp.close();
    }

    if (c === 'two') {
        const s0 = await state();
        const sc = s0.paramScroller;
        const gt = s0.gestureTargets;
        if (!sc) {
            console.log('❌ 没有参数面板 scroller（当前不在参数页签？）');
            return cdp.close();
        }
        const cx = sc.rect[0] + sc.rect[2] / 2;
        const cy = sc.rect[1] + sc.rect[3] / 2;
        const anchorBefore = await briefP();
        console.log('起点:', JSON.stringify(anchorBefore));

        // ① 画布内双指右移 60px：内容跟手 ⇒ ΔscrollLeft ≈ -60
        await drag2({ x: cx - 40, y: cy }, { x: cx + 20, y: cy }, { x: cx + 20, y: cy }, { x: cx + 80, y: cy });
        const p1 = await briefP();
        console.log('画布内 双指右移60px →', JSON.stringify(diffP(anchorBefore, p1, ['scrollLeft'])), '期望 Δ≈-60');

        // ② 画布内双指下移 60px：内容跟手 ⇒ Δcenter ≈ +60/rowHeight
        await drag2({ x: cx - 30, y: cy - 40 }, { x: cx + 30, y: cy - 40 }, { x: cx - 30, y: cy + 20 }, { x: cx + 30, y: cy + 20 });
        const p2 = await briefP();
        console.log('画布内 双指下移60px →', JSON.stringify(diffP(p1, p2, ['center', 'span'])), `期望 Δcenter≈${(60 / p1.rowHeight).toFixed(3)}`);

        // ③ 画布内双指张开：缩放 + 锚点保持（中点不动）
        const beforePinch = await briefP();
        const midX = cx - sc.rect[0];
        const sec0 = (beforePinch.scrollLeft + midX) / beforePinch.pxPerSec;
        await drag2({ x: cx - 30, y: cy }, { x: cx + 30, y: cy }, { x: cx - 90, y: cy }, { x: cx + 90, y: cy });
        const afterPinch = await briefP();
        const sec1 = (afterPinch.scrollLeft + midX) / afterPinch.pxPerSec;
        console.log(`画布内 双指张开60→180 → pxPerSec ${beforePinch.pxPerSec} → ${afterPinch.pxPerSec}（期望增大）; 中点秒 ${sec0.toFixed(4)} → ${sec1.toFixed(4)}（漂移 ${Math.abs(sec1 - sec0).toFixed(4)}）`);

        // ④ 跨区：一指拍数栏 + 一指画布（用户最常见的握法）
        const ruler = gt.find((g) => g.rect[3] < 60 && g.rect[2] > 100);
        if (ruler) {
            const ry = ruler.rect[1] + ruler.rect[3] / 2;
            const a = await briefP();
            await drag2({ x: cx - 20, y: ry }, { x: cx + 40, y: cy }, { x: cx + 40, y: ry }, { x: cx + 100, y: cy });
            const b = await briefP();
            console.log('跨区(拍数栏+画布) 双指右移60px →', JSON.stringify(diffP(a, b, ['scrollLeft', 'pxPerSec'])), '期望 有变化');
        } else {
            console.log('❌ 跨区测试：未定位到拍数栏');
        }
        return cdp.close();
    }

    if (c === 'hbar') {
        const s0 = await call(ipScrollbarProbe);
        console.log('滚动条:', JSON.stringify(s0.tracks, null, 1));
        const t = s0.tracks.find((x) => x.rect[2] > x.rect[3] && x.thumb); // 横向条
        if (!t) return cdp.close();
        const y = t.rect[1] + t.rect[3] / 2;
        const x1 = t.thumb[0] + t.thumb[2] / 2;
        const before = (await state()).paramScroller;
        await drag1(x1, y, x1 + 120, y, 700);
        const after = (await state()).paramScroller;
        console.log(`拖 thumb 右移 120px (x ${x1.toFixed(1)}→${(x1 + 120).toFixed(1)} @y=${y}) → scrollLeft ${before.scrollLeft} → ${after.scrollLeft} (Δ${(after.scrollLeft - before.scrollLeft).toFixed(1)})`);
        console.log('拖后滚动条:', JSON.stringify((await call(ipScrollbarProbe)).tracks.filter((x) => x.rect[2] > x.rect[3]), null, 1));
        return cdp.close();
    }

    console.log('未知命令:', c);
    return cdp.close();
}

main().catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
});
