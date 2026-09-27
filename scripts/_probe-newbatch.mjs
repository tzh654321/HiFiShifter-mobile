#!/usr/bin/env node
/**
 * 用户新批次 A 组（手势语义）实测：A1 播放头归属、A2 长按 vs 长按并划动、A4 播放中点拍数栏。
 *
 * A1「只有拍数栏能移动进度条」：
 *   · 触摸点音频块 → 选中，但 `playhead_sec` **不变**；
 *   · 触摸点轨道空白 → 取消选中，`playhead_sec` **不变**；
 *   · 触摸划动轨道空白 → 平移视野，`playhead_sec` **不变**；
 *   · 触摸点拍数栏 → `playhead_sec` **变**（对照组）。
 * A2「『长按』= 不移动松手时触发；不得与『长按并划动』同时生效」：
 *   · 轨道空白：按住期间注入 contextmenu → **不许**立刻弹菜单；不移动松手 → 弹菜单；
 *     按住后划动 → 出框选矩形且**不弹**菜单。
 *   · 轨道头：按住期间注入 contextmenu → 不许立刻弹；不移动松手 → 弹轨道菜单；
 *     按住后上下划动 → 只排序、不弹菜单。
 * A4：播放中点拍数栏 → 播放停止 **且**播放头跳到点击处。
 *
 * 用法：node scripts\_probe-newbatch.mjs --serial emulator-5554
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

/** 页面内：工程真值 + 关键 DOM 命中点。 */
function snap() {
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
        const vp = window.__hsViewport ? window.__hsViewport() : null;
        const raw = (s.clips || [])[0] ?? null;
        const rowEl = raw ? document.querySelector(`[data-hs-track-row="${raw.track_id}"]`) : null;
        const rows = [...document.querySelectorAll('[data-hs-track-row]')];
        const rr = rowEl ? rowEl.getBoundingClientRect() : null;
        const c = vp ? vp.containerRect : null;
        return {
            playhead: +(s.playhead_sec ?? 0).toFixed(4),
            sel: s.selected_clip_id ?? null,
            clips: (s.clips || []).length,
            /* ⚠️ 工程状态里**没有** `runtime` 字段（keys 只有 ok / tracks / clips /
               selected_track_id / selected_clip_id / bpm / playhead_sec / project_sec /
               project / tempo_map）⇒ 从后端读不到"是否在播放"。
               与 `_probe-touch-spec.mjs` 同源：看**播放按钮自己的标签**（播放 = 停止态，
               换成"暂停"之类才是播放中）。 */
            playing: (() => {
                const b = [...document.querySelectorAll('button')].find(
                    (x) => x.ariaLabel === '播放' || x.ariaLabel === '暂停',
                );
                return b ? b.ariaLabel !== '播放' : null;
            })(),
            scrollLeft: vp ? Math.round(vp.scrollLeft) : null,
            pxPerSec: vp ? vp.pxPerSec : null,
            container: c,
            rowTop: rr ? Math.round(rr.top) : null,
            rowHeight: rr ? Math.round(rr.height) : vp ? Math.round(vp.rowHeight) : null,
            clipLeft: raw && c ? Math.round(c.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft) : null,
            clipWidth: raw && vp ? Math.round(Math.max(24, raw.length_sec * vp.pxPerSec)) : null,
            rowCount: rows.length,
            menuOpen: Boolean(
                document.querySelector('[data-hs-context-menu="1"],[data-track-ctx-menu]'),
            ),
            menuKind: document.querySelector('[data-track-ctx-menu]')
                ? 'track'
                : document.querySelector('[data-hs-context-menu="1"]')
                  ? 'clip'
                  : null,
            boxActive: [...document.querySelectorAll('div')].some(
                (d) =>
                    String(d.style.border || '').includes('dashed') &&
                    d.style.display !== 'none' &&
                    d.getBoundingClientRect().width > 20,
            ),
            barPresent: Boolean(document.querySelector('[data-hs-clip-actions] > div')),
            /** B1：左右控制点浮层（`pointer-events:none` 的纯视觉抓手）。 */
            controlPoints: (() => {
                const root = document.querySelector('[data-hs-clip-control-points]');
                if (!root) return null;
                const rect = (side) => {
                    const el = root.querySelector(`[data-hs-clip-control-point="${side}"]`);
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: Math.round(r.left + r.width / 2), top: Math.round(r.top), h: Math.round(r.height) };
                };
                return { left: rect('left'), right: rect('right') };
            })(),
            trackOrder: rows.map((r) => r.getAttribute('data-hs-track-row')),
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
    /** 注入**真实** contextmenu（Android 长按时由 WebView 自己派发，CDP 触摸复现不出来）。 */
    const fireMenu = (x, y, selector) =>
        cdp.call(
            (ax, ay, sel) => {
                const el = document.querySelector(sel) ?? document.elementFromPoint(ax, ay) ?? document.body;
                el.dispatchEvent(
                    new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        clientX: ax,
                        clientY: ay,
                    }),
                );
            },
            x,
            y,
            selector,
        );

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 造一个块 + 补一条轨道（空白区用例需要**有 trackId 的空行**；轨道头用例需要 ≥2 行可排序）
    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(900);
    await cdp.call((b) => window.__hsImportAudioBase64('nb.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1500);
    for (let i = 0; i < 3; i++) {
        const g = await cdp.call(snap);
        if (g.rowCount >= 3) break;
        await cdp.call(() => {
            const row = [...document.querySelectorAll('[data-track-list-panel] div')].find(
                (d) =>
                    String(d.className).includes('border-dashed') &&
                    String(d.className).includes('cursor-pointer'),
            );
            if (row) row.click();
        });
        await sleep(900);
    }
    console.log('▸ 初始：' + JSON.stringify(await cdp.call(snap)));
    console.log('▸ 摆正后：' + JSON.stringify(await placeClipInView()));

    /** 一个"行内空白"点：第 2 行（无块）的中部。 */
    const blankInRow = () =>
        cdp.call(() => {
            const rows = [...document.querySelectorAll('[data-hs-track-row]')];
            const row = rows[1] ?? rows[0];
            const r = row.getBoundingClientRect();
            const c = window.__hsViewport().containerRect;
            return {
                x: Math.round(c.left + 100),
                y: Math.round(r.top + r.height * 0.5),
                rowTop: Math.round(r.top),
                rowHeight: Math.round(r.height),
            };
        });

    /**
     * 把「选中块」摆到视口里（缩放 + 拉回起点）。
     *
     * ⚠️ **必须先做这一步**：导入后 `pxPerSec` 可能是 3557（1px ≈ 0.0003s），
     * 2 秒的块宽 7000+px、`scrollLeft` 又可能停在几百 ⇒ 块左缘落在容器**之外**
     * （实测 `clipLeft = -44`），于是"点块体"那一下其实点在容器的**左边外面**
     * （落到轨道头列上），断言却因为"本来就选中着"而假通过。
     */
    async function placeClipInView() {
        // ① 拉回起点：触摸右划（内容跟手）直到 scrollLeft ≈ 0
        for (let i = 0; i < 30; i++) {
            const g = await cdp.call(snap);
            if (g.scrollLeft <= 1) break;
            const y = Math.round(g.container.top + g.container.height - 20);
            await touch('touchStart', [{ id: 0, x: Math.round(g.container.left + 10), y }]);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [
                    { id: 0, x: Math.round(g.container.left + 10 + ((g.container.width - 20) * k) / 6), y },
                ]);
                await sleep(26);
            }
            await touch('touchEnd', []);
            await sleep(240);
        }
        // ② 缩放到"块宽 ≈ 0.6 × 容器宽"（确定值，便于断言）
        for (let i = 0; i < 24; i++) {
            const g = await cdp.call(snap);
            const target = g.container.width * 0.6;
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
        // ③ 缩放会按播放头锚定把视口推走 ⇒ 再拉回起点一次
        for (let i = 0; i < 30; i++) {
            const g = await cdp.call(snap);
            if (g.scrollLeft <= 1) break;
            const y = Math.round(g.container.top + g.container.height - 20);
            await touch('touchStart', [{ id: 0, x: Math.round(g.container.left + 10), y }]);
            for (let k = 1; k <= 6; k++) {
                await touch('touchMove', [
                    { id: 0, x: Math.round(g.container.left + 10 + ((g.container.width - 20) * k) / 6), y },
                ]);
                await sleep(26);
            }
            await touch('touchEnd', []);
            await sleep(240);
        }
        return cdp.call(snap);
    }

    // ── A1-a 触摸点音频块：选中但不动播放头 ────────────────────────────────
    {
        const g = await cdp.call(snap);
        const x = g.clipLeft + 60;
        const y = g.rowTop + Math.round(g.rowHeight * 0.65);
        const b = await cdp.call(snap);
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(700);
        const a = await cdp.call(snap);
        check(
            'A1-a 触摸点音频块 = 选中，且**不移动**播放头',
            a.sel !== null && Math.abs(a.playhead - b.playhead) < 0.0005,
            `选中 ${b.sel} → ${a.sel}；播放头 ${b.playhead} → ${a.playhead}`,
        );
    }

    // ── A1-b 触摸点轨道空白：取消选中（前端），且不动播放头 ────────────────
    {
        const p = await blankInRow();
        const b = await cdp.call(snap);
        await touch('touchStart', [{ id: 0, x: p.x, y: p.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(700);
        const a = await cdp.call(snap);
        // 取消选中是**纯前端** reducer（后端 `selected_clip_id` 本就不同步，见
        // `handleKernelSeek` 里那段"选中复活"的长注释）⇒ 断言要看前端可见信号：
        // 常用操作浮条只在"恰好选中一个 clip"时挂载。
        check(
            'A1-b 触摸点轨道空白 = 取消选中（前端），且**不移动**播放头',
            !a.barPresent && Math.abs(a.playhead - b.playhead) < 0.0005,
            `操作条 前=${b.barPresent} → 后=${a.barPresent}；播放头 ${b.playhead} → ${a.playhead}（后端 selected 仍是 ${a.sel}，属既有单向前端语义）`,
        );
    }

    // ── A1-c 触摸划动轨道空白：平移视野，且不动播放头 ──────────────────────
    {
        const p = await blankInRow();
        const b = await cdp.call(snap);
        await touch('touchStart', [{ id: 0, x: p.x + 60, y: p.y }]);
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [{ id: 0, x: p.x + 60 - (70 * i) / 4, y: p.y }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(600);
        const a = await cdp.call(snap);
        check(
            'A1-c 触摸划动轨道 = 平移视野，且**不移动**播放头',
            a.scrollLeft > b.scrollLeft + 20 && Math.abs(a.playhead - b.playhead) < 0.0005,
            `scrollLeft ${b.scrollLeft} → ${a.scrollLeft}；播放头 ${b.playhead} → ${a.playhead}`,
        );
    }

    // ── A1-d 对照：触摸点拍数栏 = 移动进度条 ──────────────────────────────
    {
        const b = await cdp.call(snap);
        const ruler = await cdp.call(() => {
            const el = document.querySelector('[data-hs-timeline-kernel="1"]');
            const r = el ? el.getBoundingClientRect() : null;
            // 拍数栏在时间线容器**上方**：取容器上沿再往上 12px
            return r ? { x: Math.round(r.left + 120), y: Math.round(r.top - 12) } : null;
        });
        if (ruler === null) {
            check('A1-d 触摸点拍数栏 = 移动进度条', false, '找不到时间线容器');
        } else {
            await touch('touchStart', [{ id: 0, x: ruler.x, y: ruler.y }]);
            await sleep(70);
            await touch('touchEnd', []);
            await sleep(700);
            const a = await cdp.call(snap);
            check(
                'A1-d 触摸点拍数栏 = **移动**进度条（唯一入口）',
                Math.abs(a.playhead - b.playhead) > 0.01,
                `点 (${ruler.x},${ruler.y})；播放头 ${b.playhead} → ${a.playhead}`,
            );
        }
    }

    // ── A2-a 轨道空白：长按期间不弹菜单；不移动松手才弹 ────────────────────
    {
        const p = await blankInRow();
        await touch('touchStart', [{ id: 0, x: p.x, y: p.y }]);
        await sleep(640); // 越过 500ms 长按阈值
        await fireMenu(p.x, p.y, '[data-hs-timeline-kernel="1"]');
        await sleep(200);
        const during = await cdp.call(snap);
        await touch('touchEnd', []);
        await sleep(700);
        const after = await cdp.call(snap);
        check(
            'A2-a 轨道·长按不动：按住期间**不弹**菜单，松手才弹',
            !during.menuOpen && after.menuOpen,
            `按点 (${p.x},${p.y})；按住时 menuOpen=${during.menuOpen}；松手后 menuOpen=${after.menuOpen}（kind=${after.menuKind}）`,
        );
        // 关掉菜单
        await cdp.call(() => {
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await sleep(500);
    }

    // ── A2-b 轨道空白：长按并划动 = 框选，且**不弹**菜单 ──────────────────
    {
        const p = await blankInRow();
        await touch('touchStart', [{ id: 0, x: p.x, y: p.y }]);
        await sleep(640);
        await fireMenu(p.x, p.y, '[data-hs-timeline-kernel="1"]');
        await touch('touchMove', [{ id: 0, x: p.x + 40, y: p.y + 30 }]);
        await sleep(150);
        await touch('touchMove', [{ id: 0, x: p.x + 90, y: p.y + 50 }]);
        await sleep(200);
        const during = await cdp.call(snap);
        await touch('touchEnd', []);
        await sleep(700);
        const after = await cdp.call(snap);
        check(
            'A2-b 轨道·长按并划动 = 框选，且**不弹**菜单',
            during.boxActive && !during.menuOpen && !after.menuOpen,
            `拖动中 框选=${during.boxActive} 菜单=${during.menuOpen}；松手后 菜单=${after.menuOpen}`,
        );
    }

    /**
     * 轨道头上的原生触摸序列（与真机同路径）。
     *
     * ⚠️ 必须**在行元素上派发真实 `TouchEvent`**，不能用 CDP 合成触摸：CDP 那条路
     * 在轨道列表（原生滚动容器）上会被浏览器的滚动手势识别截断，`touchstart` 的
     * target 也常常落在行内的旋钮 / 按钮上 ⇒ `TrackList` 的排序监听会提前 return
     * （实测：arm 从未成立、顺序纹丝不动）。真机手指产生的是前者。
     */
    const trackTouch = (type, rowIndex, offsetY) =>
        cdp.call(
            (ty, ri, off) => {
                const row = document.querySelectorAll('[data-hs-track-row]')[ri];
                if (!row) return { error: 'no-row' };
                const b = row.getBoundingClientRect();
                const yy = b.top + off;
                const touches =
                    ty === 'touchend'
                        ? []
                        : [new Touch({ identifier: 1, target: row, clientX: b.left + 24, clientY: yy })];
                row.dispatchEvent(
                    new TouchEvent(ty, {
                        bubbles: true,
                        cancelable: true,
                        touches,
                        targetTouches: touches,
                        changedTouches: touches,
                    }),
                );
                return { ok: true, y: Math.round(yy), left: Math.round(b.left + 24), rows: document.querySelectorAll('[data-hs-track-row]').length };
            },
            type,
            rowIndex,
            offsetY,
        );
    const trackMenu = (rowIndex, offsetY) =>
        cdp.call(
            (ri, off) => {
                const row = document.querySelectorAll('[data-hs-track-row]')[ri];
                const b = row.getBoundingClientRect();
                row.dispatchEvent(
                    new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        clientX: b.left + 24,
                        clientY: b.top + off,
                    }),
                );
                return true;
            },
            rowIndex,
            offsetY,
        );

    // ── A2-c 轨道头：长按不动 → 松手弹轨道菜单 ────────────────────────────
    {
        // 先确保没有遗留菜单（否则"按住期间"的读数会被上一条用例的残留污染）
        await cdp.call(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
        });
        await sleep(600);
        const clean = await cdp.call(snap);
        const r0 = await trackTouch('touchstart', 0, 40);
        await sleep(560); // 越过 450ms
        await trackMenu(0, 40);
        await sleep(200);
        const during = await cdp.call(snap);
        await trackTouch('touchend', 0, 40);
        // 轮询：菜单是**抬手后补发**的（React setState → 下一帧才挂 DOM）
        let after = null;
        const samples = [];
        for (let i = 0; i < 14; i++) {
            await sleep(120);
            const s = await cdp.call(snap);
            samples.push(`${i}:${s.menuOpen ? s.menuKind ?? 'y' : 'n'}`);
            if (s.menuOpen) {
                after = s;
                break;
            }
        }
        check(
            'A2-c 轨道头·长按不动：按住期间**不弹**菜单，松手弹**轨道**菜单',
            clean.menuOpen === false && !during.menuOpen && after !== null && after.menuKind === 'track',
            `前置菜单已清=${!clean.menuOpen}；行数=${r0.rows}；按住时=${during.menuOpen}；松手后采样=[${samples.join(' ')}]`,
        );
        await cdp.call(() => {
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await sleep(500);
    }

    // ── A2-d 轨道头：长按并划动 = 排序，且**不弹**菜单 ────────────────────
    {
        const before = await cdp.call(snap);
        await trackTouch('touchstart', 0, 40);
        await sleep(560);
        await trackMenu(0, 40);
        await trackTouch('touchmove', 0, 140);
        await sleep(120);
        const rowH = before.rowHeight || 150;
        await trackTouch('touchmove', 0, 40 + rowH + 40);
        await sleep(200);
        const during = await cdp.call(snap);
        await trackTouch('touchend', 0, 40 + rowH + 40);
        await sleep(1200);
        const after = await cdp.call(snap);
        check(
            'A2-d 轨道头·长按并划动 = 排序，且**不弹**菜单',
            !during.menuOpen && !after.menuOpen,
            `按住时 菜单=${during.menuOpen}；松手后 菜单=${after.menuOpen}；顺序 ${JSON.stringify(before.trackOrder)} → ${JSON.stringify(after.trackOrder)}`,
        );
    }

    // ── A4 播放中点拍数栏 = 跳转并暂停 ───────────────────────────────────
    {
        const ruler = await cdp.call(() => {
            const el = document.querySelector('[data-hs-timeline-kernel="1"]');
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + 150), y: Math.round(r.top - 12) };
        });
        // 用**双击拍数栏**起播（⑧ 已验通的路径；底栏"播放"按钮在无音频焦点时不一定起播）
        for (let k = 0; k < 2; k++) {
            await touch('touchStart', [{ id: 0, x: ruler.x, y: ruler.y }]);
            await sleep(60);
            await touch('touchEnd', []);
            if (k === 0) await sleep(90);
        }
        await sleep(1000);
        const playing = await cdp.call(snap);
        await touch('touchStart', [{ id: 0, x: ruler.x + 40, y: ruler.y }]);
        await sleep(80);
        await touch('touchEnd', []);
        await sleep(1000);
        const stopped = await cdp.call(snap);
        check(
            'A4 播放中点拍数栏 = 跳转**并暂停**',
            playing.playing === true && stopped.playing === false,
            `起播后 播放中=${playing.playing}（播放头 ${playing.playhead}）→ 单击后 播放中=${stopped.playing}（播放头 ${stopped.playhead}）`,
        );
    }

    // ── B1 单击音频块 = 显示左右控制点 ────────────────────────────────────
    {
        const g0 = await placeClipInView();
        const x = g0.clipLeft + Math.round(g0.clipWidth * 0.4);
        const y = g0.rowTop + Math.round(g0.rowHeight * 0.65);
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(700);
        const g = await cdp.call(snap);
        const cp = g.controlPoints;
        const edgeTop = g.rowTop + 18;
        const edgeBottom = g.rowTop + g.rowHeight;
        const aligned =
            cp !== null &&
            cp.left !== null &&
            cp.right !== null &&
            Math.abs(cp.left.x - (g.clipLeft + 5)) <= 6 &&
            Math.abs(cp.right.x - (g.clipLeft + g.clipWidth - 5)) <= 12 &&
            cp.left.top >= edgeTop - 4 &&
            cp.left.top + cp.left.h <= edgeBottom + 4;
        check(
            'B1 单击音频块 = 显示**可见**的左右控制点（对齐内核边缘命中带）',
            cp !== null && cp.left !== null && cp.right !== null && aligned,
            `控制点=${JSON.stringify(cp)}；块左=${g.clipLeft} 块宽=${g.clipWidth} 行顶=${g.rowTop} 行高=${g.rowHeight}`,
        );
    }

    // ── B2 点别处 → 悬浮窗隐藏；再点块 → 重新出现 ────────────────────────
    {
        const g0 = await placeClipInView();
        const tapX = g0.clipLeft + Math.round(g0.clipWidth * 0.4);
        const tapY = g0.rowTop + Math.round(g0.rowHeight * 0.65);
        // 先确保浮窗在（点一次块）
        await touch('touchStart', [{ id: 0, x: tapX, y: tapY }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(700);
        const before = (await cdp.call(snap)).barPresent;
        // 「别处」取**时间线容器之外**的真实控件：顶栏的视图菜单按钮（手机上进得去、
        // 又不会改变选中）。这里用 DOM click（`pointerdown` 才是判据 ⇒ 先派发 pointerdown）。
        const clicked = await cdp.call(() => {
            const btn = [...document.querySelectorAll('button')].find(
                (b) => (b.textContent || '').trim() === '视图',
            );
            if (!btn) return 'no-button';
            const r = btn.getBoundingClientRect();
            btn.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: r.left + r.width / 2,
                    clientY: r.top + r.height / 2,
                }),
            );
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        await sleep(400);
        const hidden = await cdp.call(snap);
        // 再点块 → 应重新出现
        await touch('touchStart', [{ id: 0, x: tapX, y: tapY }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(600);
        const reshown = await cdp.call(snap);
        check(
            'B2 点别处（时间线外）→ 悬浮窗隐藏；再点块 → 重新出现',
            before === true && hidden.barPresent === false && reshown.barPresent === true,
            `点 ${JSON.stringify(clicked)}；前=${before} → 点别处后=${hidden.barPresent} → 再点块后=${reshown.barPresent}`,
        );
    }

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
