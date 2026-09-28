#!/usr/bin/env node
/**
 * D8 验收：**文件浏览器长按音频 → 拖到轨道窗**（此前阻塞于 N2，现在文件能列出来了）。
 *
 * 协议（读码确认）：`FileBrowserPanel` 的指针状态机在按住并移动后派发
 * `window` 上的自定义事件 `hifi-file-drag`
 *   `{ type: "move" | "drop", filePath, fileName, filePaths, clientX, clientY, isRightDrag }`
 * `TimelinePanel` 监听它并把音频导到落点所在轨道/时间。
 *
 * 判据：
 *   ① 前置：文件浏览器列出**磁盘上真实存在的 .wav**（N2 已修 ⇒ 经 SAF 列举）；
 *   ② 拖拽过程中有 ghost（`hifi-file-drag:move` 被派发 / 面板出现拖拽态）；
 *   ③ 放手后**时间轴块数 +1**（落点那条约轨上多出一个块）。
 *
 * ⚠️ 必须**分屏**（轨道面板 + 文件浏览器同屏），否则落点没有轨道区。
 * ⚠️ 用合成 PointerEvent（与 D2/D5 同一手法）。
 *
 * 用法：node scripts\_probe-d8-file-drag.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // ① 前置：分屏（轨道 + 文件浏览器）+ 列表里有 .wav
    const prep = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const menuItem = async (name) => {
            const trig = [...document.querySelectorAll('button')].find(
                (x) => (x.textContent || '').trim() === '视图',
            );
            trig && trig.click();
            await wait(800);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) =>
                    ((x.getAttribute('aria-label') || '').trim() === name ||
                        (x.textContent || '').trim() === name) &&
                    x.children.length <= 3,
            );
            if (it) {
                it.click();
                await wait(1800);
                return true;
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return false;
        };
        const vis = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 8 && r.width > 8;
        };
        if (!vis('[data-hs-surface="timeline"]')) await menuItem('轨道面板');
        if (!vis('[data-hs-split-handle="files"]')) await menuItem('文件浏览器');
        await wait(1500);
        const rows = [...document.querySelectorAll('[data-hs-file-item], [data-hs-file-row]')].map((e) =>
            (e.innerText || '').trim().slice(0, 40),
        );
        const wavRows = [...document.querySelectorAll('div,li')]
            .filter((e) => /\.(wav|mp3|flac|m4a|ogg)$/i.test((e.innerText || '').trim()) && e.children.length <= 4)
            .map((e) => (e.innerText || '').trim().slice(0, 40));
        return {
            timeline: vis('[data-hs-surface="timeline"]'),
            filesPanel: vis('[data-hs-split-handle="files"]'),
            rows,
            wavRows: [...new Set(wavRows)].slice(0, 6),
        };
    });
    console.log('▸ 前置：' + JSON.stringify(prep));
    check(
        'D8-前置 分屏就位，且文件浏览器列出了磁盘上的 .wav（N2 的成果）',
        prep.timeline && prep.filesPanel && prep.wavRows.length > 0,
        JSON.stringify(prep),
    );

    // ② 找落点（轨道区内一条轨道的矩形）+ 块数基线
    const before = await cdp.call(async () => {
        const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
        const st = await inv('get_timeline_state', {});
        const row = document.querySelector('[data-hs-track-row]');
        const tr = document.querySelector('[data-hs-surface="timeline"]');
        return {
            clips: (st.clips || []).length,
            trackId: row ? row.getAttribute('data-hs-track-row') : null,
            rowRect: row ? (() => { const r = row.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() : null,
            tlRect: tr ? (() => { const r = tr.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() : null,
        };
    });
    console.log('▸ 落点与基线：' + JSON.stringify(before));

    // ③ 长按 .wav 行 → 拖动 → 在轨道区松手
    const drag = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const row = [...document.querySelectorAll('div,li')].find(
            (e) => /\.(wav|mp3|flac|m4a|ogg)$/i.test((e.innerText || '').trim()) && e.children.length <= 4,
        );
        if (!row) return { error: 'no-wav-row' };
        const rr = row.getBoundingClientRect();
        const from = { x: Math.round(rr.left + Math.min(40, rr.width / 2)), y: Math.round(rr.top + rr.height / 2) };
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        const tr = tl.getBoundingClientRect();
        const trackRow = document.querySelector('[data-hs-track-row]');
        const trackRect = trackRow ? trackRow.getBoundingClientRect() : tr;
        const to = {
            x: Math.round(tr.left + tr.width * 0.55),
            y: Math.round(trackRect.top + trackRect.height * 0.6),
        };
        const seen = [];
        const onEvt = (e) => seen.push({ type: e.detail?.type, x: Math.round(e.detail?.clientX ?? 0), y: Math.round(e.detail?.clientY ?? 0), file: (e.detail?.fileName || '').slice(0, 18) });
        window.addEventListener('hifi-file-drag', onEvt);
        const mk = (type, x, y, buttons) =>
            new PointerEvent(type, {
                bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 71,
                isPrimary: true, button: type === 'pointerdown' ? 0 : -1, buttons,
                clientX: Math.round(x), clientY: Math.round(y),
            });
        row.dispatchEvent(mk('pointerdown', from.x, from.y, 1));
        await wait(700); // 长按
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const x = from.x + ((to.x - from.x) * i) / steps;
            const y = from.y + ((to.y - from.y) * i) / steps;
            window.dispatchEvent(mk('pointermove', x, y, 1));
            await wait(60);
        }
        await wait(200);
        window.dispatchEvent(mk('pointerup', to.x, to.y, 0));
        await wait(2500);
        window.removeEventListener('hifi-file-drag', onEvt);
        return { from, to, seen: seen.slice(0, 8), moveCount: seen.filter((s) => s.type === 'move').length, dropped: seen.some((s) => s.type === 'drop') };
    });
    console.log('▸ 拖拽：' + JSON.stringify(drag));
    check(
        'D8-a 长按并移动时派发 `hifi-file-drag:move`（拖拽态真的起来了）',
        (drag.moveCount ?? 0) > 0,
        `move 事件 ${drag.moveCount ?? 0} 个；样本=${JSON.stringify((drag.seen ?? []).slice(0, 3))}`,
    );
    check(
        'D8-b 放手派发 `drop`（落点交给轨道侧）',
        drag.dropped === true,
        `事件序列=${JSON.stringify((drag.seen ?? []).map((s) => s.type))}`,
    );

    // ④ 结果：导入可能异步（SAF 物化 + 解码）⇒ 轮询到稳定
    adb('logcat -c');
    let after = { clips: before.clips, names: [] };
    for (let i = 0; i < 15; i++) {
        after = await cdp.call(async () => {
            const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
            const st = await inv('get_timeline_state', {});
            return { clips: (st.clips || []).length, names: (st.clips || []).map((c) => c.name || c.id).slice(-3) };
        });
        if (after.clips > before.clips) break;
        await new Promise((r) => setTimeout(r, 1000));
    }
    const logTail = adb('logcat -d -t 40').split('\n').filter((l) => /import|saf|audio|file_drag|clip|error|warn/i.test(l)).slice(-12);
    console.log('▸ logcat：\\n' + logTail.join('\\n'));
    console.log('▸ 结果：' + JSON.stringify(after));
    check(
        'D8-c 放手后轨道上**多出一个块**（音频被导入到落点轨道）',
        after.clips === before.clips + 1,
        `块数 ${before.clips} → ${after.clips}；最后几个=${JSON.stringify(after.names)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
