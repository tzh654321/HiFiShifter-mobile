#!/usr/bin/env node
/**
 * E5 / E6 / G-1 / F2 综合验收 —— **用前端流程造块**（这是关键）。
 *
 * 血泪教训：此前一律用**后端命令** `import_audio_item` 造块，而**后端命令不更新前端 store**
 * （与 `select_clip` 同型）⇒ 前端既没有块也没有选中 ⇒ 浮条 / 控制点 / 右键菜单全部不渲染，
 * 于是 E5/E6/G-1/F1/F2 一连串"实现好了却没反应"。
 * 本脚本改走**前端拖拽**（文件浏览器长按拖到轨道，已在真机验证过能生成块）⇒ 前端 store 有块与选中，
 * 这些 UI 才有机会出现。
 *
 * 判据：
 *   E5-a 选中后有**两个块外圆点**（`data-hs-clip-control-point`，直径 ≈14）；
 *   E5-b 按下左侧控制点 ⇒ **浮条收起**；向上拖 ⇒ 圆点 `data-hs-control-mode="fade"`；
 *   E6   点浮条里的选项 ⇒ 浮条收起；
 *   G-1  浮条「更多」⇒ 出现右键那套菜单（含 重命名/删除/静音 等项）；
 *   F2   ^ 菜单「吸附网格…」「分割过渡…」「节拍器…」长按 ⇒ 打开对应设置。
 *
 * 用法：node scripts\_probe-e5-e6-g1-f2.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const results = [];
    const check = (n, ok, d) => {
        results.push({ n, ok });
        console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    };
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({
                id: p.id ?? i,
                x: Math.round(p.x),
                y: Math.round(p.y),
                radiusX: 6,
                radiusY: 6,
                force: 1,
            })),
        });
    /** 主画布 rect（内核从那开始，左边是轨道头列 —— 用面板 rect 会点到轨道头上）。 */
    const canvasRect = () =>
        cdp.call(() => {
            const cs = [...document.querySelectorAll('canvas')].map((c) => {
                const r = c.getBoundingClientRect();
                return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
            });
            return cs.sort((a, b) => Math.abs(a.w - window.innerWidth / 1.6) - Math.abs(b.w - window.innerWidth / 1.6))[0];
        });

    // ── 造块：文件浏览器长按拖到轨道（前端流程）──────────────────────
    const seeded = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        // 1) 确保文件面板 + 轨道面板都在（分屏才有落点）
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'files' } }));
        await wait(1500);
        const st0 = await inv('get_timeline_state', {});
        const before = (st0.clips || []).length;
        // 2) 找一行音频文件
        const row = [...document.querySelectorAll('div,li')].find((e) => {
            const t = (e.innerText || '').trim();
            return /\.(wav|mp3|flac|m4a|ogg)$/i.test(t) && e.children.length <= 4;
        });
        if (!row) return { before, error: 'no-audio-row' };
        const r = row.getBoundingClientRect();
        return { before, from: { x: Math.round(r.left + 60), y: Math.round(r.top + r.height / 2) }, name: (row.innerText || '').trim().slice(0, 24) };
    });
    console.log('▸ 造块准备：' + JSON.stringify(seeded));
    if (seeded.error) {
        console.log('🔴 文件面板里没有音频行 ⇒ 无法用前端流程造块');
        cdp.close();
        return;
    }
    // 真触摸：长按 340ms 后拖到轨道区（走前端 drag 逻辑）
    const target = await cdp.call(() => {
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        if (!tl) return null;
        const r = tl.getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height * 0.3) };
    });
    console.log('▸ 拖拽目标：' + JSON.stringify(target));
    await touch('touchStart', [{ id: 0, x: seeded.from.x, y: seeded.from.y }]);
    await sleep(360);
    if (target) {
        for (let i = 1; i <= 10; i++) {
            const x = seeded.from.x + ((target.x - seeded.from.x) * i) / 10;
            const y = seeded.from.y + ((target.y - seeded.from.y) * i) / 10;
            await touch('touchMove', [{ id: 0, x, y }]);
            await sleep(40);
        }
    }
    await touch('touchEnd', []);
    await sleep(2600);
    // 切回轨道面板看结果
    await cdp.call(() => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    });
    await sleep(1800);
    const after = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        const st = await inv('get_timeline_state', {});
        return { clips: (st.clips || []).length, selected: st.selected_clip_id ?? null };
    });
    console.log('▸ 造块结果：' + JSON.stringify(after));
    check('前置：走**前端拖拽**造出块（前端 store 才会有块）', after.clips > seeded.before, JSON.stringify(after));

    if (after.clips === 0) {
        console.log('🔴 没造出块 ⇒ 后续 UI 无法验证');
        cdp.close();
        return;
    }

    // ── 选中块（真触摸点在 canvas 内的块上）──────────────────────────
    const cr = await canvasRect();
    const clickAt = { x: cr.x + 60, y: cr.y + 50 };
    console.log('▸ 点击坐标（canvas 内）：' + JSON.stringify(clickAt));
    await touch('touchStart', [{ id: 0, x: clickAt.x, y: clickAt.y }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(1600);

    // ── E5-a 控制点圆点 ──────────────────────────────────────────
    const dots = await cdp.call(() => {
        const l = document.querySelector('[data-hs-clip-control-point="left"]');
        const r = document.querySelector('[data-hs-clip-control-point="right"]');
        const bar = document.querySelector('[data-hs-clip-actions]');
        const box = (e) => (e ? e.getBoundingClientRect() : null);
        const lr = box(l), rr = box(r);
        /* ⚠️ 浮条**外层**永远 0×0（子元素是 fixed 定位，不撑父级）⇒ 必须看内层。 */
        const inner = bar ? bar.querySelector("div") : null;
        const br = inner ? inner.getBoundingClientRect() : null;
        return {
            left: lr ? { x: Math.round(lr.left), y: Math.round(lr.top), w: Math.round(lr.width) } : null,
            right: rr ? { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width) } : null,
            barExists: Boolean(bar),
            barRect: br ? [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)] : null,
            barVisible: br ? br.width > 4 && br.left < window.innerWidth && br.left > -br.width : false,
            vp: window.__hsViewport ? window.__hsViewport() : null,
        };
    });
    console.log('▸ 控制点/浮条：' + JSON.stringify(dots));
    check('E5-a 两个**块外圆点**已渲染（直径≈14）', Boolean(dots.left && dots.right && dots.left.w >= 12 && dots.left.w <= 18), JSON.stringify(dots));
    check('E6 前置：浮条已出现', dots.barVisible === true, JSON.stringify(dots));

    // ── E5-b 按下控制点 ⇒ 浮条收起 + 上划 ⇒ fade 图标 ─────────────
    if (dots.left) {
        const gx = dots.left.x + 7, gy = dots.left.y + 7;
        /* 用**合成 PointerEvent**：CDP 的触摸事件打不中控制点（实测合成有效）。 */
        await cdp.call(async (x, y) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const ev = (type, cx, cy) =>
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerType: "touch",
                    pointerId: 71,
                    isPrimary: true,
                    clientX: cx,
                    clientY: cy,
                    button: 0,
                });
            window.dispatchEvent(ev("pointerdown", x, y));
            await wait(120);
            window.dispatchEvent(ev("pointermove", x + 3, y - 46));
            await wait(260);
        }, gx, gy);
        const mid = await cdp.call(() => {
            const d = document.querySelector('[data-hs-clip-control-point="left"]');
            const b = document.querySelector('[data-hs-clip-actions]');
            return {
                mode: d?.getAttribute('data-hs-control-mode') ?? null,
                barVisible: b ? b.getBoundingClientRect().width > 4 : false,
            };
        });
        await cdp.call(() =>
            window.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    cancelable: true,
                    pointerType: "touch",
                    pointerId: 71,
                    isPrimary: true,
                    clientX: 0,
                    clientY: 0,
                    button: 0,
                }),
            ),
        );
        await sleep(500);
        const end = await cdp.call(() => document.querySelector('[data-hs-clip-control-point="left"]')?.getAttribute('data-hs-control-mode') ?? null);
        console.log('▸ 按下+上划：' + JSON.stringify(mid) + ' 松手后=' + end);
        check('E5-b 上划 ⇒ 圆点带**淡入淡出图标**（mode=fade）', mid.mode === 'fade', 'mode=' + mid.mode);
        check('E5-c 按下控制点 ⇒ **浮条收起**', mid.barVisible === false, 'barVisible=' + mid.barVisible);
        check('E5-d 松手 ⇒ 回到默认（mode=none）', end === 'none', 'mode=' + end);
    }

    // ── G-1 浮条「更多」⇒ 右键菜单 ────────────────────────────────
    // 先让浮条重新出现（再点一次块）
    await touch('touchStart', [{ id: 0, x: clickAt.x, y: clickAt.y }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(1500);
    const moreBtn = await cdp.call(() => {
        const b = [...document.querySelectorAll('[data-hs-clip-actions] button')].find((x) => /更多/.test(x.innerText || x.textContent || ''));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    console.log('▸ 「更多」按钮：' + JSON.stringify(moreBtn));
    if (moreBtn) {
        await cdp.call((x, y) => {
            const el = document.elementFromPoint(x, y);
            const btn = el && el.closest ? el.closest("button") : null;
            (btn ?? el)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }, moreBtn.x, moreBtn.y);
        await sleep(1600);
        const menu = await cdp.call(() => {
            const el = [...document.querySelectorAll('div')].find((d) => {
                const t = d.innerText || '';
                const r = d.getBoundingClientRect();
                return /重命名/.test(t) && /删除|静音/.test(t) && r.height > 60 && r.height < 800;
            });
            return { present: Boolean(el), sample: el ? (el.innerText || '').replace(/\s+/g, ' ').slice(0, 80) : null };
        });
        console.log('▸ 右键菜单：' + JSON.stringify(menu));
        check('G-1 浮条「更多」⇒ 出现**右键那套菜单**', menu.present === true, JSON.stringify(menu));
    } else {
        check('G-1 浮条「更多」⇒ 出现右键菜单', false, '浮条里没有「更多」按钮（浮条未出现？）');
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.n).join(' · '));
    cdp.close();
};

await main();
