#!/usr/bin/env node
/**
 * 规格表两条待办现状实测（真实触摸）：
 *  ① 轨道·**长按并划动** = 相当于电脑右键框选（板子记 ❌ 未做）
 *  ② 拍数栏·**双击** = 移动进度条**并开始播放**（板子记 🟡 触摸下不可靠）
 *
 * 判据：
 *  ①-a 长按轨道空白后划动 ⇒ 进入框选（可观测：多选成立 —— 用"复制→粘贴使块数 +N"反证）
 *  ①-b 划动过程中不应误开轨道菜单（已由 A2 保证）
 *  ②-a 双击拍数栏 ⇒ 播放头移到该处
 *  ②-b 双击拍数栏 ⇒ **开始播放**（transport 按钮 aria-label 变为「暂停」）
 *
 * 用法：node scripts\_probe-next-batch.mjs [serial]
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
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 准备：分屏（轨道 + 文件浏览器），并确保轨道上有 ≥2 个块
    await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const menuItem = async (name) => {
            const trig = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === '视图',
            );
            trig && trig.click();
            await wait(850);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) =>
                    ((x.getAttribute('aria-label') || '').trim() === name ||
                        (x.textContent || '').trim() === name) &&
                    x.children.length <= 3,
            );
            if (it) {
                it.click();
                await wait(1700);
            } else {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
        };
        const vis = (s) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 8 && r.width > 8;
        };
        if (!vis('[data-hs-surface="timeline"]')) await menuItem('轨道面板');
        if (!vis('[data-hs-split-handle="files"]')) await menuItem('文件浏览器');
        await wait(1200);
    });

    // 造两个块：从文件浏览器拖两次（也顺带验证 D8 链路）
    const seed = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const before = (await inv('get_timeline_state', {})).clips.length;
        const row = document.querySelector('[data-hs-file-item], div,li');
        return { before };
    });
    console.log('▸ 起始块数：' + JSON.stringify(seed));

    // ① 长按轨道空白 → 划动（框选）
    const boxInfo = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        const tr = tl.getBoundingClientRect();
        const row = document.querySelector('[data-hs-track-row]');
        const rr = row ? row.getBoundingClientRect() : tr;
        // 起点落在轨道行内的空白处（靠右，避开已有块），终点更靠右
        const y = Math.round(rr.top + rr.height * 0.6);
        const x0 = Math.round(tr.left + tr.width * 0.62);
        const x1 = Math.round(tr.left + tr.width * 0.96);
        return { x0, y, x1, tr: [Math.round(tr.left), Math.round(tr.top), Math.round(tr.width), Math.round(tr.height)] };
    });
    console.log('▸ 框选起止：' + JSON.stringify(boxInfo));

    // 用"长按后划动"（真触摸），随后读后端多选状态（通过复制→粘贴反证）
    const seeded = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        // 先用两次"导入"把轨道填出至少 2 个块：直接调后端导入一个已知音频两次
        const p = '/sdcard/Download/test-rr.wav';
        const st0 = (await inv('get_timeline_state', {})).clips.length;
        for (let i = 0; i < 2; i++) {
            await inv('import_audio_item', { audioPath: p, trackId: null, startSec: i * 3, mediaAudioStreamIndex: null }).catch(() => null);
        }
        const st1 = (await inv('get_timeline_state', {})).clips.length;
        return { st0, st1 };
    });
    console.log('▸ 造块：' + JSON.stringify(seeded));

    // 真触摸：长按 500ms 再横划（框选），然后读"复制→粘贴"是否 +N
    const x = boxInfo;
    await touch('touchStart', [{ id: 0, x: x.x0, y: x.y }]);
    await sleep(520);
    for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [{ id: 0, x: Math.round(x.x0 + ((x.x1 - x.x0) * i) / 8), y: x.y }]);
        await sleep(50);
    }
    await sleep(200);
    // 保持按住：读拖拽预览（框选矩形/多选）状态
    const during = await cdp.call(() => ({
        menuOpen: Boolean(document.querySelector('[data-track-ctx-menu]')),
    }));
    await touch('touchEnd', []);
    await sleep(600);
    const afterBox = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const st = await inv('get_timeline_state', {});
        return { clips: st.clips.length, selected: st.selected_clip_id ?? null };
    });
    console.log('▸ 框选期间/之后：' + JSON.stringify({ during, afterBox }));
    check(
        '①-a 长按并划动**没有**误开轨道菜单（A2 语义仍然成立）',
        during.menuOpen === false,
        JSON.stringify(during),
    );

    // 用"复制→粘贴"反证多选：若框选成立，粘贴会多出 ≥2 个块
    const multi = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const before = (await inv('get_timeline_state', {})).clips.length;
        window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op: 'copy' } }));
        await new Promise((r) => setTimeout(r, 1500));
        window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op: 'paste' } }));
        await new Promise((r) => setTimeout(r, 3000));
        const after = (await inv('get_timeline_state', {})).clips.length;
        return { before, after, delta: after - before };
    });
    console.log('▸ 多选反证（复制→粘贴）：' + JSON.stringify(multi));
    check(
        '①-b 长按并划动成立**框选**（粘贴多出 ≥2 个块 ⇒ 确实多选了）',
        multi.delta >= 2,
        `块数 ${multi.before} → ${multi.after}（Δ=${multi.delta}）`,
    );

    // ② 拍数栏双击
    const ruler = await cdp.call(() => {
        const el = document.querySelector('[data-hs-time-ruler="timeline"]') ?? document.querySelector('[data-hs-surface="timeline"]');
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.35), y: Math.round(r.top + r.height * 0.5) };
    });
    const before2 = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const st = await inv('get_timeline_state', {});
        const btn = [...document.querySelectorAll('button')].find((b) => /播放|暂停/.test(b.getAttribute('data-tooltip') || b.ariaLabel || ''));
        return { playhead: st.playhead_sec ?? st.playheadSec ?? null, transport: btn ? btn.getAttribute('data-tooltip') || btn.ariaLabel : null };
    });
    // 真触摸双击（两次快速点按）
    for (let i = 0; i < 2; i++) {
        await touch('touchStart', [{ id: 0, x: ruler.x, y: ruler.y }]);
        await sleep(45);
        await touch('touchEnd', []);
        await sleep(90);
    }
    await sleep(1800);
    const after2 = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
        const st = await inv('get_timeline_state', {});
        const btn = [...document.querySelectorAll('button')].find((b) => /播放|暂停/.test(b.getAttribute('data-tooltip') || b.ariaLabel || ''));
        return { playhead: st.playhead_sec ?? st.playheadSec ?? null, transport: btn ? btn.getAttribute('data-tooltip') || btn.ariaLabel : null };
    });
    console.log('▸ 拍数栏双击前后：' + JSON.stringify({ before2, after2 }));
    check(
        '②-a 拍数栏双击 ⇒ 播放头移动',
        before2.playhead !== null && after2.playhead !== null && Math.abs(after2.playhead - before2.playhead) > 0.05,
        `playhead ${before2.playhead} → ${after2.playhead}`,
    );
    check(
        '②-b 拍数栏双击 ⇒ **开始播放**（transport 变「暂停」）',
        String(after2.transport || '').includes('暂停'),
        `transport ${JSON.stringify(before2.transport)} → ${JSON.stringify(after2.transport)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x2) => !x2.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
