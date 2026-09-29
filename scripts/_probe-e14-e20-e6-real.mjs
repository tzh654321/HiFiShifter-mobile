#!/usr/bin/env node
/**
 * 真机验收：E14 / E20 / E6（三条此前"已实现、待设备验收"的条目）。
 *
 * E14 双指缩放**参数界面**时不得移动进度条
 *     （用户口径："这一点只在轨道界面做到了"）
 *     判据：① 双指捏合（真实两指触摸）前后 playhead 不变；
 *           ② 反例：单指轻点参数界面拍数栏 ⇒ playhead **应**变（证明探针本身有效）。
 *
 * E20 **播放中单击拍数栏：先暂停、再跳转**
 *     （否则 stopAudioPlayback 的 fulfilled 会把位置回写，落点被覆盖回暂停处）
 *     判据：播放中单击拍数栏远端 ⇒ 播放停止 **且** playhead 落在点击处（不是原地）。
 *
 * E6 点击浮条里的选项后**浮条收起**
 *     判据：点块选中 ⇒ `[data-hs-clip-actions]` 出现 ⇒ 点它的第一个可点项 ⇒ 消失。
 *
 * 用法：node scripts\_probe-e14-e20-e6-real.mjs [serial]
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

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };
    const state = () =>
        cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
            const btn = [...document.querySelectorAll('button')].find((b) =>
                /播放|暂停/.test(b.getAttribute('data-tooltip') || b.ariaLabel || ''),
            );
            return {
                playhead: Math.round((st.playhead_sec ?? 0) * 1000) / 1000,
                clips: (st.clips || []).length,
                transport: (btn?.getAttribute('data-tooltip') || btn?.ariaLabel || '').trim(),
                playing: Boolean(st.playing),
            };
        });

    // 准备：确保参数面板 + 轨道面板可见，并有一个块（浮条需要选中块）
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const vis = (s) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 8 && r.width > 8;
        };
        const menuItem = async (name) => {
            const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            trig && trig.click();
            await wait(900);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) => ((x.getAttribute('aria-label') || '').trim() === name || (x.textContent || '').trim() === name) && x.children.length <= 3,
            );
            if (it) {
                it.click();
                await wait(1800);
            } else {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
        };
        if (!vis('[data-hs-surface="timeline"]')) await menuItem('轨道面板');
        if (!vis('[data-hs-time-ruler="params"]')) await menuItem('参数面板');
        await wait(1000);
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
        if ((st.clips || []).length === 0) {
            await window.__TAURI_INTERNALS__.invoke('import_audio_item', {
                audioPath: '/sdcard/Download/test-rr.wav',
                trackId: null,
                startSec: 0,
                mediaAudioStreamIndex: null,
            });
            await wait(2500);
        }
    });
    await sleep(1200);
    const s0 = await state();
    console.log('▸ 初始状态：' + JSON.stringify(s0));

    // ── E14：双指捏合参数界面 ⇒ 不移动进度条 ───────────────────────
    const paramsRuler = await cdp.call(() => {
        const el = document.querySelector('[data-hs-time-ruler="params"]') ?? document.querySelector('[data-hs-surface="params"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), top: Math.round(r.top) };
    });
    console.log('▸ 参数拍数栏：' + JSON.stringify(paramsRuler));
    if (paramsRuler) {
        const before14 = await state();
        // 两指：同时落下 → 相互靠拢再分开（捏合）
        const y = paramsRuler.cy;
        const xa = paramsRuler.cx - 40;
        const xb = paramsRuler.cx + 40;
        await touch('touchStart', [{ id: 0, x: xa, y }, { id: 1, x: xb, y }]);
        for (let i = 1; i <= 8; i++) {
            await touch('touchMove', [
                { id: 0, x: xa + i * 2, y },
                { id: 1, x: xb - i * 2, y },
            ]);
            await sleep(35);
        }
        for (let i = 1; i <= 8; i++) {
            await touch('touchMove', [
                { id: 0, x: xa + 16 - i * 2, y },
                { id: 1, x: xb - 16 + i * 2, y },
            ]);
            await sleep(35);
        }
        await touch('touchEnd', []);
        await sleep(900);
        const after14 = await state();
        check(
            'E14-a 双指捏合参数界面 **不移动进度条**',
            Math.abs(after14.playhead - before14.playhead) < 0.02,
            `playhead ${before14.playhead} → ${after14.playhead}（差 ${Math.round((after14.playhead - before14.playhead) * 1000) / 1000}s）`,
        );

        // 反例：单指轻点参数拍数栏 ⇒ 应移动（证明双指不动是真效果，而不是"根本没接 seek"）
        const tapX = Math.round(paramsRuler.cx - 70); // 换一处点：与捏合前所处位置不同才看得出"会不会移动"
        await touch('touchStart', [{ id: 0, x: tapX, y }]);
        await sleep(50);
        await touch('touchEnd', []);
        await sleep(900);
        const afterTap14 = await state();
        check(
            'E14-b 反例：单指轻点参数拍数栏 ⇒ **会**移动进度条',
            Math.abs(afterTap14.playhead - after14.playhead) > 0.02,
            `playhead ${after14.playhead} → ${afterTap14.playhead}`,
        );
    } else {
        console.log('🔴 找不到参数界面拍数栏，E14 无法验证');
    }

    // ── E20：播放中单击拍数栏 ⇒ 先暂停、再跳转 ─────────────────────
    const tlRuler = await cdp.call(() => {
        const el = document.querySelector('[data-hs-time-ruler="timeline"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            left: Math.round(r.left),
            right: Math.round(r.right),
            y: Math.round(r.top + r.height / 2),
        };
    });
    console.log('▸ 轨道拍数栏：' + JSON.stringify(tlRuler));
    if (tlRuler) {
        /* 起播：**点底栏的播放按钮**（真实 UI 路径；直接调后端命令会在没 catch 时
           把探针整个抛崩 —— 之前就是这样，也说明"走 UI"更贴近用户场景）。 */
        const started = await cdp.call(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const findPlay = () =>
                [...document.querySelectorAll('button')].find((b) => {
                    const s = (b.getAttribute('data-tooltip') || b.ariaLabel || b.textContent || '').trim();
                    return s === '播放';
                });
            const btn = findPlay();
            if (!btn) return { ok: false, why: 'no-play-button' };
            const r = btn.getBoundingClientRect();
            return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (started.ok) {
            await touch('touchStart', [{ id: 0, x: started.x, y: started.y }]);
            await sleep(60);
            await touch('touchEnd', []);
        }
        await sleep(2200);
        const playing = await state();
        console.log('▸ 起播后：' + JSON.stringify({ started, playing }));
        // 点远端（靠右 80%）
        const clickX = Math.round(tlRuler.left + (tlRuler.right - tlRuler.left) * 0.8);
        await touch('touchStart', [{ id: 0, x: clickX, y: tlRuler.y }]);
        await sleep(55);
        await touch('touchEnd', []);
        await sleep(2200);
        const after20 = await state();
        const expected = await cdp.call(() => {
            const w = window.__hsViewport ? window.__hsViewport() : null;
            return w ? { scrollLeft: w.scrollLeft, pxPerSec: w.pxPerSec } : null;
        });
        const wantSec = expected
            ? Math.round((expected.scrollLeft + (clickX - tlRuler.left) / expected.pxPerSec) * 100) / 100
            : null;
        console.log('▸ 单击后：' + JSON.stringify({ after20, wantSec }));
        check(
            'E20-a 播放中单击拍数栏 ⇒ **暂停**（transport 回到「播放」）',
            !/暂停/.test(after20.transport),
            `transport="${after20.transport}"（播放中应为「暂停」，暂停后应为「播放」）`,
        );
        check(
            'E20-b 落点**停在点击处**（不是被回写回暂停点）',
            wantSec !== null && Math.abs(after20.playhead - wantSec) < Math.max(0.6, (wantSec || 1) * 0.05),
            `playhead=${after20.playhead}s，点击处≈${wantSec}s（差 ${wantSec !== null ? Math.round((after20.playhead - wantSec) * 100) / 100 : 'n/a'}s）`,
        );
    }

    // ── E6：点浮条里的选项 ⇒ 浮条收起 ──────────────────────────────
    const tapClip = await cdp.call(async () => {
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        const tr = tl.getBoundingClientRect();
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {});
        const clip = (st.clips || [])[0];
        if (!clip || !vp) return null;
        const start = clip.start_sec ?? 0;
        const dur = Math.max(0.5, clip.duration_sec ?? 1);
        const x = tr.left + (start - (vp.scrollLeft ?? 0)) * vp.pxPerSec + (dur * vp.pxPerSec) / 2;
        const y = tr.top + (vp.rowHeight ?? 48) * 0.5;
        // ⚠️ 用块的**左侧可视部分**：一段 140s 的音频块很宽，中心点可能落在可视区之外，\n        //    而浮条门控要求"块在可视区内"（`ClipQuickActions` 里 return null 的那条）。\n        const xLeft = tr.left + (start - (vp.scrollLeft ?? 0)) * vp.pxPerSec;\n        return { x: Math.round(Math.min(Math.max(xLeft + 24, tr.left + 6), tr.right - 6)), y: Math.round(y) };
    });
    console.log('▸ 点块坐标：' + JSON.stringify(tapClip));
    if (tapClip) {
        await touch('touchStart', [{ id: 0, x: tapClip.x, y: tapClip.y }]);
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(1600);
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
    console.log('▸ 选中/浮条：' + JSON.stringify(bar));
    if (bar.barPresent && bar.btn) {
        await touch('touchStart', [{ id: 0, x: bar.btn.x, y: bar.btn.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1500);
    }
    const afterE6 = await cdp.call(() => {
        const el = document.querySelector('[data-hs-clip-actions]');
        const vis = el
            ? (() => {
                  const r = el.getBoundingClientRect();
                  return r.width > 4 && r.height > 4 && getComputedStyle(el).display !== 'none';
              })()
            : false;
        return { barVisible: vis };
    });
    check(
        'E6 点浮条里的选项后**浮条收起**',
        bar.barPresent === true && afterE6.barVisible === false,
        `选中=${bar.selected}，浮条出现=${bar.barPresent}（项="${bar.btn?.text ?? ''}"）→ 点后可见=${afterE6.barVisible}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
