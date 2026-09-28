#!/usr/bin/env node
/**
 * E2 / E6 验收（模拟器或真机均可）。
 *
 * E2：「轨道界面左上角 拍数/秒数 的**秒数调小字体**」
 *     ⇒ `[data-hs-tracklist-readout-secondary]` 的实测 font-size 必须**小于**主读数的；
 *        且两段都还在（不是把秒数整段删了）；读数盒宽不塌（minWidth 仍撑着）。
 *
 * E6：「**点击临时菜单中的选项后也要隐藏菜单**」（浮条 = ClipQuickActions）
 *     ⇒ 选中一个块使浮条出现 → 点浮条里第一个可点项 → 浮条应**消失**。
 *        （覆盖 B2 的旧行为：原设计"点按钮不收起浮条"。）
 *
 * 用法：node scripts\_probe-e2-e6.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 准备：确保轨道面板可见，并导入一个音频作为"块"
    const prep = await cdp.call(async (audioPath) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 120) }));
        const vis = (s) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.height > 8 && r.width > 8;
        };
        if (!vis('[data-hs-surface="timeline"]')) {
            const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
            trig && trig.click();
            await wait(900);
            const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find(
                (x) => ((x.getAttribute('aria-label') || '').trim() === '轨道面板' || (x.textContent || '').trim() === '轨道面板') && x.children.length <= 3,
            );
            it && it.click();
            await wait(2000);
        }
        const before = (await inv('get_timeline_state', {})).clips.length;
        let importResult = null;
        if (before === 0) {
            importResult = await inv('import_audio_item', {
                audioPath,
                trackId: null,
                startSec: 0,
                mediaAudioStreamIndex: null,
            });
            await wait(2500);
        }
        return { clips: (await inv('get_timeline_state', {})).clips.length, importResult };
    }, '/sdcard/Download/test-rr.wav');
    console.log('▸ 轨道块数：' + JSON.stringify({ clips: prep.clips, missing: prep.importResult?.missing_files ?? prep.importResult?.err ?? null }));
    if (prep.clips === 0) {
        console.log('🔴 准备工作失败：轨道上没有块，E6 无法验证（先修 import）');
    }

    // ── E2：读数两段的字号 ──────────────────────────────────────────
    // 盒宽由 ResizeObserver + 字体度量算出，刚挂载时可能还是 null ⇒ 等一拍再量。
    await sleep(1600);
    const e2 = await cdp.call(() => {
        const box = document.querySelector('[data-hs-tracklist-readout]');
        const sec = document.querySelector('[data-hs-tracklist-readout-secondary]');
        const primarySpan = box ? box.querySelector('span') : null;
        const fs = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
        // 主读数字号取样：读数盒里第一个可见文本节点的 font-size
        const textEls = box ? [...box.querySelectorAll('span')].filter((e) => (e.textContent || '').trim().length) : [];
        const primaryFont = textEls.length ? fs(textEls[0]) : null;
        return {
            hasBox: Boolean(box),
            boxMinWidth: box ? getComputedStyle(box).minWidth : null,
            /* ⚠️ 宽度不是靠 minWidth 撑的（那是 `SlotTimeText` 的等宽槽位自己撑出来的）
               ⇒ 判据要用**实际盒宽 vs 内容宽**，不然会误判成"塌了"。 */
            boxWidth: box ? Math.round(box.getBoundingClientRect().width) : null,
            scrollWidth: box ? Math.round(box.scrollWidth) : null,
            overflow: box ? Math.round(box.scrollWidth - box.clientWidth) : null,
            secondaryPresent: Boolean(sec),
            secondaryFont: sec ? fs(sec) : null,
            secondaryText: sec ? (sec.innerText || '').trim() : null,
            primaryFont,
        };
    });
    console.log('▸ E2 量测：' + JSON.stringify(e2));
    check(
        'E2-a 秒数那一段**存在**且字号**小于**主读数',
        e2.secondaryPresent === true &&
            e2.secondaryFont !== null &&
            e2.primaryFont !== null &&
            e2.secondaryFont < e2.primaryFont - 0.5,
        `主 ${e2.primaryFont}px vs 秒 ${e2.secondaryFont}px（文本 "${e2.secondaryText}"）`,
    );
    check(
        'E2-b 读数盒宽度容得下内容（不塌、不溢出）',
        e2.boxWidth !== null && e2.boxWidth > 30 && e2.overflow <= 2,
        `盒宽 ${e2.boxWidth}px，内容 ${e2.scrollWidth}px（溢出 ${e2.overflow}px）`,
    );

    // ── E6：点浮条里的选项后应收起浮条 ─────────────────────────────
    // 先选中一个块（点它的中心）
    /* 用**视口真值**算块的实际屏幕位置（瞎猜坐标会落空 ⇒ 浮条不出现，误判成"E6 未实现"）。
       x = 容器左 + (startSec - scrollLeft) * pxPerSec；y = 容器顶 + rowHeight 的半个行高。 */
    const tapClip = await cdp.call(async () => {
        const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
        const tl = document.querySelector('[data-hs-surface="timeline"]');
        const tr = tl.getBoundingClientRect();
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const st = await inv('get_timeline_state', {});
        const clip = st && st.clips && st.clips[0];
        if (!clip || !vp) return { x: Math.round(tr.left + 40), y: Math.round(tr.top + 40), fallback: true };
        const start = clip.start_sec ?? clip.startSec ?? 0;
        const dur = Math.max(0.5, clip.duration_sec ?? clip.durationSec ?? 1);
        const px = tr.left + (start - (vp.scrollLeft ?? 0)) * vp.pxPerSec + (dur * vp.pxPerSec) / 2;
        const py = tr.top + (vp.rowHeight ?? 48) * 0.5;
        return {
            x: Math.round(Math.min(Math.max(px, tr.left + 4), tr.right - 4)),
            y: Math.round(py),
            start,
            vp: { scrollLeft: vp.scrollLeft, pxPerSec: vp.pxPerSec, rowHeight: vp.rowHeight },
        };
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x: tapClip.x, y: tapClip.y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1600);

    const barInfo = await cdp.call(() => {
        const bar = document.querySelector('[data-hs-clip-actions]');
        const btn = bar ? bar.querySelector('button, [role=button], [role=menuitem]') : null;
        const r = btn ? btn.getBoundingClientRect() : null;
        return {
            barPresent: Boolean(bar),
            firstActionText: btn ? (btn.innerText || btn.getAttribute('aria-label') || '').trim().slice(0, 12) : null,
            firstAction: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
        };
    });
    console.log('▸ 浮条：' + JSON.stringify(barInfo));

    if (barInfo.barPresent && barInfo.firstAction) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: barInfo.firstAction.x, y: barInfo.firstAction.y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(70);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(1500);
    }
    const afterTap = await cdp.call(() => {
        const bar = document.querySelector('[data-hs-clip-actions]');
        const vis = bar
            ? (() => {
                  const r = bar.getBoundingClientRect();
                  return r.width > 4 && r.height > 4 && getComputedStyle(bar).display !== 'none';
              })()
            : false;
        return { barPresent: Boolean(bar), barVisible: vis };
    });
    console.log('▸ 点选项后：' + JSON.stringify(afterTap));
    check(
        'E6 点浮条里的选项后**浮条收起**',
        barInfo.barPresent === true && afterTap.barVisible === false,
        `点前存在=${barInfo.barPresent}（项="${barInfo.firstActionText}"）→ 点后可见=${afterTap.barVisible}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
