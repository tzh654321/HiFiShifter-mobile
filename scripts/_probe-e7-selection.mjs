#!/usr/bin/env node
/**
 * E7 验收：「轨道头菜单调整辈分后，选中会不会跳到第一个导入的音频」。
 *
 * 用户原话（`docs/prompt.md:98`）：「在轨道头菜单调整了辈分后有概率选中第一个导入的音频，
 * 未能复现」——「未能复现」说明是**竞态**，靠手点很难稳定撞上；这里把它变成确定性判据。
 *
 * 【根因（代码级）】`sessionSlice.ts` 的 `applyTimelineState` 会**无条件**采纳后端快照里的
 * 选中态（`selected_track_id` / `selected_clip_id`），而"调整辈分"= `moveTrackRemote`，
 * 其 `fulfilled` 正好走这条全量覆写 ⇒ 前端刚选中的块被后端**自己记住的那一份**顶掉。
 * 后端记的往往是**本会话里最初被选中的那个块**（＝第一个导入的音频）⇒ 就是用户看到的现象。
 * 「有概率」＝两者恰好一致时看不出来。
 *
 * 判据：`选中第 2 个块 → 调整辈分 → 选中必须还是第 2 个块`。
 *
 * 用法：node scripts/_probe-e7-selection.mjs [--serial emulator-5554] [--wav D:\\Temp\\hs-tone.wav]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, wav: 'D:\\Temp\\hs-tone.wav' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--wav') o.wav = argv[++i];
    }
    return o;
}

function inPageSelection() {
    const fn = window.__hsSelection;
    if (typeof fn !== 'function') return { error: 'no-selection-hook' };
    return fn();
}

/** 页面内：菜单里点某一项（菜单是自定义 `div[role=menu]`，用 label 文本找）。 */
function inPageClickMenuItem() {
    /* 占位：真正的逻辑在下面 cdp.call 里内联（需要传参） */
    return null;
}

async function main() {
    const o = parseArgs(process.argv);
    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '❌'} ${name}`);
        if (detail) console.log('     ' + detail);
    };

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

    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const tap = async (x, y, ms = 60) => {
        await touch('touchStart', [{ x, y }]);
        await sleep(ms);
        await touch('touchEnd', []);
        await sleep(300);
    };

    /* ── 前置：时间线全屏（分屏时画布矮，行/块容易落进浮层）────────────── */
    const prepared = await cdp.call(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
        await w(900);
        window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: 'params' } }));
        await w(900);
        return {
            sel: typeof window.__hsSelection === 'function',
            vp: typeof window.__hsViewport === 'function',
            importHook: typeof window.__hsImportAudioBase64 === 'function',
            vw: innerWidth,
        };
    });
    console.log('▸ 前置钩子：' + JSON.stringify(prepared));
    if (!prepared.sel) throw new Error('缺少 __hsSelection 钩子（需要重新构建装机）');
    if (!prepared.importHook) throw new Error('缺少 __hsImportAudioBase64 钩子');
    const SCREEN_W = prepared.vw;

    /** 打开顶栏「<label>」菜单并点同名项；返回 {ok} 或 {error}。 */
    async function openMenuAndClick(menuLabel, itemLabel) {
        return cdp.call(
            async (menuText, itemText) => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const menu = () => document.querySelector('[role="menu"]');
                /* 先把上一轮的菜单关掉（点空白处） */
                if (menu()) {
                    document.body.dispatchEvent(
                        new MouseEvent('pointerdown', { bubbles: true, clientX: 3, clientY: 3 }),
                    );
                    await wait(500);
                }
                const btn = [...document.querySelectorAll('button')].find(
                    (b) => (b.innerText || '').trim() === menuText,
                );
                if (!btn) {
                    return {
                        error: 'no-menu-button',
                        buttons: [...document.querySelectorAll('button')]
                            .map((b) => (b.innerText || '').trim())
                            .filter(Boolean)
                            .slice(0, 20),
                    };
                }
                const r = btn.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                    btn.dispatchEvent(
                        new MouseEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }),
                    );
                }
                let m = null;
                for (let i = 0; i < 8; i++) {
                    await wait(200);
                    m = menu();
                    if (m) break;
                }
                if (!m) return { error: 'menu-not-opened' };
                const items = [...m.querySelectorAll('button, [role="menuitem"]')];
                const it = items.find((b) => (b.innerText || '').trim().replace(/\s+/g, ' ') === itemText);
                if (!it) {
                    return { error: 'no-item', seen: items.map((b) => (b.innerText || '').trim().slice(0, 10)) };
                }
                if (it.disabled === true || it.getAttribute('aria-disabled') === 'true') {
                    return { error: 'item-disabled', seen: items.map((b) => (b.innerText || '').trim().slice(0, 10)) };
                }
                it.click();
                await wait(1500);
                return { ok: true };
            },
            menuLabel,
            itemLabel,
        );
    }

    /** 当前工程快照。 */
    const snap = () =>
        cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state');
            return {
                sel: window.__hsSelection(),
                clips: (st.clips || []).map((c) => ({ id: c.id, track: c.track_id, start: c.start_sec, len: c.length_sec })),
                tracks: (st.tracks || []).map((t) => ({ id: t.id, parent: t.parent_id ?? null })),
            };
        });

    /* ── 场景：确保有 ≥2 条轨道（"调整辈分"在 1 条轨道上根本不可点）────────── */
    let s = await snap();
    console.log(`▸ 起始：${s.tracks.length} 轨 / ${s.clips.length} 块`);
    if (s.tracks.length < 2) {
        const add = await openMenuAndClick('轨道', '添加轨道');
        console.log('▸ 添加轨道：' + JSON.stringify(add));
        await sleep(1200);
        s = await snap();
    }
    if (s.tracks.length < 2) {
        console.log(`  ⚠️ 只有 ${s.tracks.length} 条轨道 ⇒ 「降低辈分」不可点，判据无法取到（需要 ≥2 轨）`);
        cdp.close();
        process.exit(2);
    }

    /* ── 导入两个音频（导入后会自动选中新块）────────────────────────── */
    const bytes = readFileSync(o.wav);
    const b64 = bytes.toString('base64');
    for (const [i, at] of [0, 5].entries()) {
        const r = await cdp.call(
            async (name, data, startSec) => {
                const res = await window.__hsImportAudioBase64(name, data, startSec);
                return { ok: res && res.ok };
            },
            `hs-e7-${Date.now()}-${i}.wav`,
            b64,
            at,
        );
        console.log(`▸ 导入 #${i + 1}（at=${at}s）：${JSON.stringify(r)}`);
        await sleep(1100);
    }
    s = await snap();
    const byStart = [...s.clips].sort((a, b) => a.start - b.start);
    console.log(`▸ 场景：${s.tracks.length} 轨 / ${s.clips.length} 块；选中=${JSON.stringify(s.sel)}`);
    if (byStart.length < 2) {
        console.log('  ⚠️ 少于 2 个块 ⇒ 无法区分"选中是否跳走"');
        cdp.close();
        process.exit(2);
    }
    const first = byStart[0];
    const target = byStart[byStart.length - 1]; // 最后导入的（＝前端当前选中的那个）

    check(
        'E7-① 前置：导入后选中的是**最后**导入的块（不是第一个）',
        s.sel.clipId === target.id,
        `选中=${s.sel.clipId}  最后导入=${target.id}  第一个=${first.id}`,
    );

    /* 让"被选中的轨道"在同级里不是第一个 ⇒ 「降低辈分」可点 */
    const trackIdx = s.tracks.findIndex((t) => t.id === s.sel.trackId);
    if (trackIdx <= 0) {
        const rowInfo = await cdp.call(() => {
            const rows = [...document.querySelectorAll('[data-hs-track-row]')];
            return rows.map((r) => {
                const b = r.getBoundingClientRect();
                return { top: Math.round(b.top), h: Math.round(b.height), left: Math.round(b.left) };
            });
        });
        console.log('▸ 轨道行：' + JSON.stringify(rowInfo));
        if (rowInfo.length >= 2) {
            const r = rowInfo[1];
            await tap(Math.max(20, Math.round(r.left + 40)), Math.round(r.top + r.h * 0.5), 60);
            await sleep(900);
            const s2 = await snap();
            console.log('▸ 点第 2 轨头部后：选中=' + JSON.stringify(s2.sel));
            s = s2;
        }
    }

    const selBefore = (await snap()).sel;
    console.log(`▸ 调整辈分前：选中=${JSON.stringify(selBefore)}`);

    /* ── 触发辈分调整 ─────────────────────────────────────────────────── */
    const before = await snap();
    let clicked = await openMenuAndClick('轨道', '降低辈分');
    if (clicked.error === 'item-disabled') {
        clicked = await openMenuAndClick('轨道', '升高辈分');
    }
    console.log('▸ 点辈分项：' + JSON.stringify(clicked));
    await sleep(2600);
    const after = await snap();
    console.log('  调整后：选中=' + JSON.stringify(after.sel));
    console.log('  轨道：' + JSON.stringify(before.tracks) + ' → ' + JSON.stringify(after.tracks));

    if (clicked.ok) {
        const moved =
            JSON.stringify(before.tracks) !== JSON.stringify(after.tracks);
        check(
            'E7-② 辈分调整确实生效（轨道结构发生变化）',
            moved,
            `调整前=${JSON.stringify(before.tracks)}\n     调整后=${JSON.stringify(after.tracks)}`,
        );
        check(
            'E7-③ 调整辈分后，选中**没有跳走**',
            after.sel.clipId === selBefore.clipId,
            `选中=${after.sel.clipId}\n     期望=${selBefore.clipId}（调整前选中的块）  误跳到=${first.id}（第一个导入的音频）`,
        );
    } else {
        console.log('  ⚠️ 辈分项不可点 ⇒ 判据 ②③ 未取到');
    }

    /* ── 回归：合法选中切换仍要生效（导入新块会自动选中它）──────────────── */
    const r3 = await cdp.call(
        async (name, data) => {
            const res = await window.__hsImportAudioBase64(name, data, 12);
            return { ok: res && res.ok };
        },
        `hs-e7-${Date.now()}-r.wav`,
        b64,
    );
    await sleep(1400);
    const s3 = await snap();
    const newest = [...s3.clips].sort((a, b) => b.start - a.start)[0];
    check(
        'E7-④ 回归：新导入的块仍会被选中（"保留选中"没把选中锁死）',
        s3.sel.clipId === newest.id,
        `导入=${JSON.stringify(r3)}  选中=${s3.sel.clipId}  新块=${newest.id}`,
    );

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n通过 ${pass} / ${results.length}`);
    cdp.close();
    if (pass !== results.length) process.exit(1);
}

await main();
