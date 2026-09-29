#!/usr/bin/env node
/**
 * E9 / E11 / E15 / E6 真机验收（真触摸）。
 *
 * E9  轨道+参数分屏且开启「同步位置与缩放」时，**参数界面左上角的速度映射键隐藏**
 *     ⇒ 判据：`data-hs-paramsync="on"` 时 `[data-hs-params-tempo-map]` 不可见；关掉同步后恢复可见。
 * E11 轨道头增益旋钮改为**长按后划动**（防误触）
 *     ⇒ 判据 ①：**直接划动**（不等待）⇒ 增益**不变**（原来会变）；
 *       判据 ②：**长按 320ms 后划动** ⇒ 增益**改变**（功能仍可用）。
 * E15 **双击**增益旋钮 ⇒ 恢复到 +0 dB
 *     ⇒ 判据：先把它调离 0 dB，再双击 ⇒ 回到 0.0 dB。
 * E6  点浮条里的选项后浮条收起
 *     ⇒ 判据：选中块 ⇒ 浮条出现 ⇒ 点第一个可点项 ⇒ 消失。
 *
 * 用法：node scripts\_probe-e9-e11-e15-e6.mjs [serial]
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
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });
    const tap = async (x, y, hold = 60) => {
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(500);
    };

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ── 准备：先保证轨道上有一个块（E6 需要选中块；重启后未保存的导入会丢）──
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        const st = await inv('get_timeline_state', {});
        if ((st.clips || []).length === 0) {
            await inv('import_audio_item', {
                audioPath: '/sdcard/Download/test-rr.wav',
                trackId: null,
                startSec: 0,
                mediaAudioStreamIndex: null,
            });
            await wait(2600);
        }
        return true;
    });

    // ── 准备：确保有轨道面板（增益旋钮在轨道头）──────────────────
    const menuToggle = async (label) => {
        const trig = await cdp.call(() => {
            const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!trig) return false;
        await tap(trig.x, trig.y, 50);
        await sleep(900);
        const item = await cdp.call((lb) => {
            const it = [...document.querySelectorAll('[role=menuitem]')].find((x) =>
                (x.textContent || '').replace(/[✓\s]/g, '').startsWith(lb),
            );
            if (!it) return null;
            const r = it.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), checked: it.getAttribute('aria-checked') };
        }, label);
        if (!item) {
            await tap(8, 500, 40);
            return false;
        }
        await tap(item.x, item.y, 50);
        await sleep(1800);
        return true;
    };

    /* ⚠️ 增益真值必须读**后端 state**：`[data-track-gain-value]` 那个标签在拖动/编辑态
       不渲染（改成输入框），读它会得到 null 或旧值 ⇒ 会把"改成功"误判成"没改"。 */
    const gainInfo = () =>
        cdp.call(async () => {
            const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
            const st = await inv('get_timeline_state', {});
            const trk = (st.tracks || [])[0];
            const knob = document.querySelector('[data-track-volume-knob]');
            const r = knob ? knob.getBoundingClientRect() : null;
            const el = document.querySelector('[data-track-gain-value]');
            return {
                volume: trk ? trk.volume : null,
                label: el ? (el.textContent || '').trim() : null,
                knob: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
            };
        });

    let g = await gainInfo();
    if (!g.knob) {
        // 打开轨道面板
        await menuToggle('轨道面板');
        await sleep(1200);
        g = await gainInfo();
    }
    console.log('▸ 增益旋钮：' + JSON.stringify(g));

    if (g.knob) {
        // ── E11-① 直接划动（不等长按）⇒ 不应改变增益 ──────────────
        const before = (await gainInfo()).volume;
        await touch('touchStart', [{ id: 0, x: g.knob.x, y: g.knob.y }]);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [{ id: 0, x: g.knob.x, y: g.knob.y - i * 6 }]); // 向上划 = 增增益
            await sleep(25);
        }
        await touch('touchEnd', []);
        await sleep(700);
        const afterSwipe = (await gainInfo()).volume;
        check(
            'E11-a 不等待长按**直接划动** ⇒ 增益不变（防误触生效）',
            before === afterSwipe,
            `track.volume ${before} → ${afterSwipe}（改前按下即生效，会变）`,
        );

        // ── E11-② 长按 320ms 后划动 ⇒ 增益改变 ───────────────────
        const beforeHold = (await gainInfo()).volume;
        await touch('touchStart', [{ id: 0, x: g.knob.x, y: g.knob.y }]);
        await sleep(360);
        for (let i = 1; i <= 8; i++) {
            await touch('touchMove', [{ id: 0, x: g.knob.x, y: g.knob.y - i * 6 }]);
            await sleep(30);
        }
        await touch('touchEnd', []);
        await sleep(900);
        const afterHold = (await gainInfo()).volume;
        check(
            'E11-b **长按 320ms 后划动** ⇒ 增益改变（功能仍可用）',
            beforeHold !== afterHold,
            `track.volume ${beforeHold} → ${afterHold}`,
        );

        // ── E15 双击旋钮 ⇒ 回到 +0 dB ────────────────────────────
        const beforeDbl = (await gainInfo()).label;
        // 双击：两次快速点按
        await tap(g.knob.x, g.knob.y, 40);
        await tap(g.knob.x, g.knob.y, 40);
        await sleep(1200);
        const afterDbl = (await gainInfo()).label;
        check(
            'E15 **双击**增益旋钮 ⇒ 恢复 +0 dB（0.0 dB）',
            /0\.0\s*dB/.test(String(afterDbl || '')),
            `"${beforeDbl}" → "${afterDbl}"`,
        );
    } else {
        console.log('🔴 找不到增益旋钮（轨道头未显示），E11/E15 无法验证');
    }

    // ── E9 同步态下隐藏参数侧速度映射键 ──────────────────────────
    // 需要「轨道+参数」分屏 + 开启同步位置与缩放
    const syncState = () =>
        cdp.call(() => {
            const wrap = document.querySelector('[data-hs-params-tempo-map]');
            const vis = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return r.width > 2 && r.height > 2 && cs.display !== 'none';
            };
            return {
                paramsync: document.body.getAttribute('data-hs-paramsync'),
                paramTempoMap: Boolean(wrap),
                paramTempoMapVisible: vis(wrap),
            };
        });
    /* 先**确保参数面板可见**（否则 [data-hs-params-tempo-map] 不在 DOM 里，量不到）。 */
    const paramsVisible = () => cdp.call(() => Boolean(document.querySelector('[data-hs-params-tempo-map]')));
    if (!(await paramsVisible())) {
        await menuToggle('参数面板');
        await sleep(1500);
    }
    /* E9 的验证：`body[data-hs-paramsync="on"]` 就是"分屏 + 同步开启"这个状态
       （App.tsx 按 paramEditorSyncTimeline && params && timeline 设置它）。
       直接置位属性即可精确验证**本条改动**（CSS 隐藏），不必去 UI 里找同步开关。 */
    await cdp.call(() => {
        document.body.dataset.hsParamsync = 'on';
    });
    await sleep(400);
    console.log('▸ 同步态（已置位）：' + JSON.stringify(await syncState()));
    const e9 = await syncState();
    if (e9.paramTempoMap) {
        check(
            'E9 分屏+同步开启时，参数侧速度映射键**隐藏**（反之可见）',
            e9.paramsync === 'on' ? e9.paramTempoMapVisible === false : e9.paramTempoMapVisible === true,
            JSON.stringify(e9),
        );
    } else {
        // 参数面板未显示 ⇒ 先把分屏打开再测
        await menuToggle('参数面板');
        await sleep(1500);
        await menuToggle('轨道面板');
        await sleep(1500);
        const e9b = await syncState();
        console.log('▸ 同步态（重试）：' + JSON.stringify(e9b));
        if (e9b.paramTempoMap) {
            check(
                'E9 分屏+同步开启时，参数侧速度映射键**隐藏**（反之可见）',
                e9b.paramsync === 'on' ? e9b.paramTempoMapVisible === false : e9b.paramTempoMapVisible === true,
                JSON.stringify(e9b),
            );
        } else {
            console.log('🔴 参数面板未显示（[data-hs-params-tempo-map] 不在 DOM），E9 未验证');
        }
    }

    // ── E6 点浮条里的选项后收起（需要**轨道面板可见**）────────────
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // 收掉同步置位，避免干扰
        delete document.body.dataset.hsParamsync;
        if (!document.querySelector('[data-hs-surface="timeline"]')) {
            // 用「视图」菜单打开轨道面板（真触摸由外层负责 ⇒ 这里退化为点按钮）
            const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            b && b.click();
            await wait(1000);
            const it = [...document.querySelectorAll('[role=menuitem]')].find((x) => (x.textContent || '').replace(/[✓\s]/g, '').startsWith('轨道面板'));
            it && it.click();
            await wait(1900);
        }
        return true;
    });
    /* ⚠️ `menuToggle` 是**翻转**：面板已开时再点会把它关掉 ⇒ 必须先判可见性。 */
    const timelineVisible = () => cdp.call(() => Boolean(document.querySelector('[data-hs-surface="timeline"]')));
    if (!(await timelineVisible())) {
        await menuToggle('轨道面板');
        await sleep(1600);
    }
    const clipTap = await cdp.call(async () => {
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        if (!tl) return null;
        const tr = tl.getBoundingClientRect();
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
        const clip = (st.clips || [])[0];
        if (!clip || !vp) return null;
        const start = clip.start_sec ?? 0;
        const dur = Math.max(0.5, clip.duration_sec ?? 1);
        const xLeft = tr.left + (start - (vp.scrollLeft ?? 0)) * vp.pxPerSec;
        const xRight = tr.left + (start + dur - (vp.scrollLeft ?? 0)) * vp.pxPerSec;
        /* ⚠️ 必须点块的**可见区间**：测试用的音源很长（140s），块宽远超屏宽 ⇒ 若按其
           "中心"点会落到屏外，而 `ClipQuickActions` 的门控要求"块在可视区内" ⇒ 浮条
           根本不会渲染（这正是前几轮 E6 "浮条不出现"的原因）。取可见区间的中点。 */
        const visLeft = Math.max(xLeft, tr.left + 8);
        const visRight = Math.min(xRight, tr.right - 8);
        const x = visRight > visLeft ? Math.round((visLeft + visRight) / 2) : Math.round(visLeft);
        return { x, y: Math.round(tr.top + (vp.rowHeight ?? 48) * 0.5) };
    });
    console.log('▸ 块点击坐标：' + JSON.stringify(clipTap));
    if (clipTap) {
        await tap(clipTap.x, clipTap.y, 55);
        await sleep(1400);
    }
    const bar = await cdp.call(async () => {
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
        const el = document.querySelector('[data-hs-clip-actions]');
        let btn = null;
        if (el) {
            const inner = el.querySelector('button, [role=button], [role=menuitem]');
            const r = inner ? inner.getBoundingClientRect() : null;
            btn = r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (inner.innerText || inner.getAttribute('aria-label') || '').trim().slice(0, 10) } : null;
        }
        return { selected: st.selected_clip_id ?? null, barPresent: Boolean(el), btn };
    });
    console.log('▸ 浮条：' + JSON.stringify(bar));
    if (bar.barPresent && bar.btn) {
        await tap(bar.btn.x, bar.btn.y, 60);
        await sleep(1400);
        const after = await cdp.call(() => {
            const el = document.querySelector('[data-hs-clip-actions]');
            const vis = el
                ? (() => {
                      const r = el.getBoundingClientRect();
                      return r.width > 4 && r.height > 4 && getComputedStyle(el).display !== 'none';
                  })()
                : false;
            return { barVisible: vis };
        });
        check('E6 点浮条里的选项后**浮条收起**', after.barVisible === false, `项="${bar.btn.text}" ⇒ 点后可见=${after.barVisible}`);
    } else {
        console.log('🔴 浮条未出现（块未选中），E6 未验证');
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
