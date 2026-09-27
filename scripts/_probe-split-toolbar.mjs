#!/usr/bin/env node
/**
 * C3 验收：**分屏模式下**上工具栏的 复制/剪切/粘贴 + 音高加减 要作用于
 * **轨道界面选中的音频块**（而不是参数编辑器的选区）。
 *
 * 怎么验才不是"看着像"：
 *   · 复制/粘贴走**可观测闭环** —— 轨道侧选一个块 → 点「复制」→ 点「粘贴」→
 *     工程里的块数应当 +1（参数编辑器侧粘贴绝不会增加时间轴的块数）。
 *   · 剪切同理（块数 -1）。
 *   · 音高加减没有简单可读的落地值，所以**包一层钩子计数**：
 *     把 `window.__hsKeybindingAction`（App 的统一执行体）与 `window.__hsEditOp`
 *     （参数编辑器桥）各包一层计数器，然后断言：
 *       活动表面 = 轨道 → 走 `__hsKeybindingAction("pianoRoll.shiftParamUp")`
 *       活动表面 = 参数 → 走 `__hsEditOp("shiftParamUpSelection")`
 *     这两条正好是"分流正确"的定义。
 *
 * 用法：node scripts\_probe-split-toolbar.mjs --serial emulator-5554
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : d;
};
const serial = arg('serial', 'emulator-5554');
const WAV = 'D:\\Temp\\hs-tone.wav';

function snap() {
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const raw = (s.clips || [])[0];
        const rows = [...document.querySelectorAll('[data-hs-track-row]')];
        const rowEl = raw ? document.querySelector(`[data-hs-track-row="${raw.track_id}"]`) : null;
        const rr = rowEl ? rowEl.getBoundingClientRect() : null;
        return {
            clips: (s.clips || []).length,
            sel: s.selected_clip_id ?? null,
            clipLeft: raw && vp ? Math.round(vp.containerRect.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft) : null,
            clipWidth: raw && vp ? Math.round(Math.max(24, raw.length_sec * vp.pxPerSec)) : null,
            rowTop: rr ? Math.round(rr.top) : null,
            rowHeight: rr ? Math.round(rr.height) : vp ? Math.round(vp.rowHeight) : null,
            container: vp ? vp.containerRect : null,
            rows: rows.length,
            paramsOpen: Boolean(document.querySelector('[data-hs-surface="pianoRoll"]')),
            paramRows: document.querySelectorAll('.hs-param-rows').length,
            editBtns: [...document.querySelectorAll('.hs-param-toolrow .hs-edit-btn')].map((b) =>
                (b.getAttribute('aria-label') || '').slice(0, 12),
            ),
        };
    });
}

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
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

    /**
     * 等到块数**稳定**再读（时间轴的粘贴/剪切是异步排队的：`pasteClipsAtPlayhead`
     * 自带 busy/queued 守卫，一次粘贴可能分多拍落库）。
     *
     * 之前的失败就是**在"还在长"的窗口里读数字**：读到 1 → 6 → 8 → 18，
     * 看着像"一次粘贴 +5、剪切还能 +10"，其实只是队列在被消费。
     *
     * @returns 稳定后的块数与剪贴板类型。
     */
    const settle = async (ms = 1200, maxMs = 15000) => {
        const t0 = Date.now();
        let last = -1;
        let stableSince = Date.now();
        while (Date.now() - t0 < maxMs) {
            const g = await cdp.call(snap);
            if (g.clips !== last) {
                last = g.clips;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= ms) {
                return { ...g, kind: await cdp.call(kindOf) };
            }
            await sleep(220);
        }
        return { ...(await cdp.call(snap)), kind: await cdp.call(kindOf), timedOut: true };
    };
    function kindOf() {
        return window.__TAURI_INTERNALS__
            .invoke('clipboard_kind')
            .then((r) => (r && r.kind) || null)
            .catch(() => 'err');
    }

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /* ⓪ 自愈：上一轮若在页面里包过 `dispatchEvent`，这里先还原再重置计数器。
       否则"包过的 dispatchEvent + 已被重置的 `__c3`"会让**每一次** hifi 事件派发
       都在页面里抛异常（实测踩过两次）。 */
    await cdp.call(() => {
        const w = window;
        if (typeof w.__c3_origDispatch === 'function') {
            w.dispatchEvent = w.__c3_origDispatch;
            delete w.__c3_origDispatch;
        }
        w.__c3 = { key: [], edit: [], events: [] };
    });

    /* ⓪b **清空剪贴板**：它是后端（系统剪贴板）状态、**跨重启留存** —— 前面几轮探针
       把时间轴剪贴板堆脏了（一次粘贴 +5/+7 就是"剪贴板里躺着 N 个旧块"）。
       写一个空载荷即替换整个逻辑剪贴板，随后 `clipboard_kind` 应不再是 "clips"。 */
    const kindAfterClear = await cdp.call(() =>
        window.__TAURI_INTERNALS__
            .invoke('write_system_clipboard_object', { payload: '', textSummary: 'cleared' })
            .then(() => window.__TAURI_INTERNALS__.invoke('clipboard_kind'))
            .then((r) => (r && r.kind) || null)
            .catch((e) => 'err:' + String(e)),
    );
    console.log('▸ 清空剪贴板后 kind=' + JSON.stringify(kindAfterClear));

    // ① 把工程清成**恰好 1 个块**。
    // ⚠️ 必须**轮询到 0** 再导入：上一轮探针的粘贴会把块数堆到上百，一次
    // `delete` 是异步的、900ms 等不完 ⇒ 后面的"块数 +1/-1"全部失真（踩过：
    // 摆正后看到 clips=163，粘贴一次 +6 是因为**剪贴板里躺着 6 个旧块**）。
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    let cleared = 0;
    for (let i = 0; i < 40; i++) {
        await sleep(300);
        cleared = (await cdp.call(snap)).clips;
        if (cleared === 0) break;
        await cdp.call(() => {
            const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
            fire('selectAll');
            fire('delete');
        });
    }
    console.log(`▸ 清空后块数=${cleared}`);
    await cdp.call((b) => window.__hsImportAudioBase64('split.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1500);
    let afterImport = await cdp.call(snap);
    if (afterImport.clips !== 1) {
        throw new Error(`导入后应恰好 1 个块，实得 ${afterImport.clips}（工程没清干净，后面的块数断言不可信）`);
    }

    // ② 打开**参数面板** → 分屏（timeline + params 同屏）
    const openParams = await cdp.call(async () => {
        if (document.querySelector('.hs-param-rows')) return 'already';
        const clickText = async (text) => {
            const el = [...document.querySelectorAll('button')].find(
                (b) => (b.textContent || '').trim() === text,
            );
            if (!el) return false;
            el.click();
            return true;
        };
        await clickText('视图');
        await new Promise((r) => setTimeout(r, 300));
        await clickText('参数面板');
        await new Promise((r) => setTimeout(r, 1200));
        return document.querySelector('.hs-param-rows') ? 'opened' : 'missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(openParams));

    // ③ 把块摆进视口（缩放+拉回起点），再**触摸点选**它 ⇒ 活动表面 = timeline
    const place = async () => {
        const panToStart = async (maxIter) => {
            for (let i = 0; i < maxIter; i++) {
                const g = await cdp.call(snap);
                if (!g.container || g.scrollLeft === 0) return;
                const y = Math.round(g.container.top + g.container.height - 40);
                await touch('touchStart', [{ id: 0, x: Math.round(g.container.left + 10), y }]);
                for (let k = 1; k <= 6; k++) {
                    await touch('touchMove', [
                        { id: 0, x: Math.round(g.container.left + 10 + ((g.container.width - 20) * k) / 6), y },
                    ]);
                    await sleep(24);
                }
                await touch('touchEnd', []);
                await sleep(200);
            }
        };
        /* ① **先复位视口**：缩放锚定播放头（`anchorScreenX = 0`），连按几次缩小会把
           scrollLeft 拉回 ≈ 播放头×新缩放 ⇒ 等于复位。上几轮探针的粘贴把工程撑得
           极长——实测 `clipLeft` 到过 **−48090**，纯靠滑动每趟只走一个容器宽，
           要几百次才能回到起点。 */
        for (let i = 0; i < 8; i++) {
            const g = await cdp.call(snap);
            if (g.scrollLeft < 200) break;
            await cdp.call(() =>
                window.dispatchEvent(
                    new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: 0.35 } }),
                ),
            );
            await sleep(200);
        }
        await panToStart(10);
        // ② 缩放到块宽 ≈ 0.5 容器宽
        for (let i = 0; i < 24; i++) {
            const g = await cdp.call(snap);
            if (!g.container) break;
            const target = g.container.width * 0.5;
            if (Math.abs(g.clipWidth - target) <= 4) break;
            const factor = Math.min(8, Math.max(0.125, target / Math.max(1, g.clipWidth)));
            await cdp.call(
                (f) =>
                    window.dispatchEvent(
                        new CustomEvent('hifi:zoomTimelineFocus', { detail: { factor: f } }),
                    ),
                factor,
            );
            await sleep(200);
        }
        await panToStart(30);
        return cdp.call(snap);
    };
    let g = await place();
    console.log('▸ 摆正后：' + JSON.stringify(g));

    /* 触摸点选块（活动表面 → timeline），并且**保证是单选**：
       多选会让剪贴板装 N 个块，"粘贴使块数 +1"的断言就不成立了
       （实测踩过：剪贴板里躺着 7 个旧块 ⇒ 一次粘贴 +7）。
       判据用**常用操作浮条**：它只在"恰好选中一个块"时挂载
       （`ClipQuickActions` 对 `multiSelectedClipIds.length > 1` 直接 return null）。
       ⇒ 先点空白（取消选中 = 前端全清），再点块；浮条出现即单选成立。 */
    const tapBlankThenClip = async (gg) => {
        /* ⚠️ 空白点必须取「块行**下方**、容器底边之上」的中段：
             · 容器**最底部约 14px 是横向滚动条的预留带** —— 点它会把视图滚到末尾
               （实测：点 (right-10, bottom-14) 之后块的屏幕 x 从 132 变成 −96，
               正好是 −容器宽，随后"点块"落在容器外 ⇒ 什么都没选中）；
             · 取块行下方 20px 处既在轨道区内、又远离滚动条带。 */
        const blankY = Math.min(
            Math.round(gg.container.top + gg.container.height - 40),
            Math.round(gg.rowTop + gg.rowHeight + 20),
        );
        await touch('touchStart', [
            { id: 0, x: Math.round(gg.container.left + gg.container.width - 30), y: blankY },
        ]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(500);
        await touch('touchStart', [
            { id: 0, x: gg.clipLeft + Math.round(gg.clipWidth * 0.4), y: gg.rowTop + Math.round(gg.rowHeight * 0.6) },
        ]);
        await sleep(80);
        await touch('touchEnd', []);
        await sleep(700);
        const st = await cdp.call(snap);
        return { ...st, barPresent: await cdp.call(() => Boolean(document.querySelector('[data-hs-clip-actions] > div'))) };
    };
    const selected = await tapBlankThenClip(g);
    console.log('▸ 点选块之后：' + JSON.stringify(selected));
    check(
        'C3-前置 分屏模式下能**单选**一个块（浮条出现 = 恰好选中一个）',
        selected.clips === 1 && selected.barPresent === true,
        `块数=${selected.clips}；浮条=${selected.barPresent}；sel=${selected.sel}`,
    );

    // ④ 包钩子计数器 + **事件通道日志**（看清每个按钮把事件发到了哪条通道）
    await cdp.call(() => {
        const w = window;
        w.__c3 = { key: [], edit: [], events: [] };
        const k = w.__hsKeybindingAction;
        const e = w.__hsEditOp;
        w.__hsKeybindingAction = (...a) => {
            w.__c3.key.push(String(a[0]));
            return k ? k(...a) : undefined;
        };
        w.__hsEditOp = (...a) => {
            w.__c3.edit.push(String(a[0]));
            return e ? e(...a) : undefined;
        };
        const orig = w.dispatchEvent.bind(w);
        w.__c3_origDispatch = w.dispatchEvent;
        w.dispatchEvent = (ev) => {
            const t = ev && ev.type;
            // ⚠️ 守卫：探针在同一页面里可能被**重复运行**，上一轮包过的 dispatchEvent
            // 还在（`__c3` 已被本轮重置为 undefined）⇒ 不判空就会在页面里抛
            // "Cannot read properties of undefined (reading 'push')"（踩过）。
            if (w.__c3 && Array.isArray(w.__c3.events) && typeof t === 'string' && t.startsWith('hifi:')) {
                w.__c3.events.push(`${t}:${(ev.detail && ev.detail.op) || ''}`);
            }
            return orig(ev);
        };
    });

    /** 点工具行上的某个编辑按钮（按 aria-label 找）。 */
    const tapEditBtn = async (labelPrefix) => {
        const box = await cdp.call((prefix) => {
            const btn = [...document.querySelectorAll('.hs-param-toolrow .hs-edit-btn')].find((b) =>
                (b.getAttribute('aria-label') || '').startsWith(prefix),
            );
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, labelPrefix);
        if (!box) return false;
        await touch('touchStart', [{ id: 0, x: box.x, y: box.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(900);
        return true;
    };

    // ⑤ 复制 → 粘贴：块数 +1（只有轨道通道会改时间轴的块数）
    {
        const before = await settle();
        await tapEditBtn('复制');
        const afterCopy = await cdp.call(() => window.__c3);
        const kindAfterCopy = await cdp.call(kindOf);
        await tapEditBtn('粘贴');
        const after = await settle();
        check(
            'C3-a 分屏 · 轨道侧选中块 → 「复制 → 粘贴」使**时间轴块数 +1**',
            after.clips === before.clips + 1,
            `块数 ${before.clips} → ${after.clips}（稳定后读取；粘贴前剪贴板 kind=${kindAfterCopy}）；复制时通道=${JSON.stringify(afterCopy.events)}`,
        );
    }

    // ⑥ 剪切：块数 -1
    {
        await cdp.call(() => {
            window.__c3.events = [];
        });
        const before = await settle();
        await tapEditBtn('剪切');
        const after = await settle();
        const log = await cdp.call(() => window.__c3.events);
        check(
            'C3-b 分屏 · 轨道侧选中块 → 「剪切」使**时间轴块数 -1**',
            after.clips === before.clips - 1,
            `块数 ${before.clips} → ${after.clips}（稳定后读取）；通道日志=${JSON.stringify(log)}`,
        );
    }

    // ⑦ 音高加减的分流：轨道侧 → __hsKeybindingAction；参数侧 → __hsEditOp
    {
        await cdp.call(() => {
            window.__c3 = { key: [], edit: [] };
        });
        // 先把块选回来（剪切之后没有块了 ⇒ 重新粘一个并点选）
        await tapEditBtn('粘贴');
        await sleep(1200);
        let gg = await place();
        await touch('touchStart', [
            { id: 0, x: gg.clipLeft + Math.round(gg.clipWidth * 0.4), y: gg.rowTop + Math.round(gg.rowHeight * 0.6) },
        ]);
        await sleep(80);
        await touch('touchEnd', []);
        await sleep(700);
        await tapEditBtn('参数线上移');
        const c1 = await cdp.call(() => window.__c3);
        check(
            'C3-c 轨道侧「音高上移」→ 走 App 的**音频块范围平移**执行体',
            c1.key.includes('pianoRoll.shiftParamUp') && c1.edit.length === 0,
            `__hsKeybindingAction=${JSON.stringify(c1.key)}；__hsEditOp=${JSON.stringify(c1.edit)}`,
        );

        // 切到参数侧：触摸点一下钢琴窗（活动表面 → pianoRoll）
        await cdp.call(() => {
            window.__c3 = { key: [], edit: [] };
            const el = document.querySelector('[data-hs-surface="pianoRoll"]');
            if (el) {
                const r = el.getBoundingClientRect();
                el.dispatchEvent(
                    new PointerEvent('pointerdown', {
                        bubbles: true,
                        clientX: r.left + 30,
                        clientY: r.top + 30,
                    }),
                );
            }
        });
        await sleep(300);
        await tapEditBtn('参数线上移');
        const c2 = await cdp.call(() => window.__c3);
        check(
            'C3-d 参数侧「音高上移」→ 仍走 `hifi:editOp` 的**选择范围平移**（未被带偏）',
            c2.edit.includes('shiftParamUpSelection') && c2.key.length === 0,
            `__hsEditOp=${JSON.stringify(c2.edit)}；__hsKeybindingAction=${JSON.stringify(c2.key)}`,
        );
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
