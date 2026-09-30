#!/usr/bin/env node
/**
 * 造块（**走真实前端流程**：文件浏览器长按 → 拖到参数面板）。
 *
 * 【为什么需要它】F1/G-1（浮条「更多」⇒ 右键那套菜单）一直验不成，根因是**前提不满足**：
 * 菜单的渲染分支是 `const ctxClip = sessionRef.current.clips.find(...); if (!ctxClip) return null`
 * —— 而 `session.clips` 是**前端 store** 的块列表。此前探针用后端 `import_audio_item` 造块，
 * 该命令**不更新前端 store**（项目里已记录过的坑，与 `select_clip` 同型）⇒ 前端始终"没有块"
 * ⇒ 事件派发出去也没人渲染菜单。
 *
 * 本脚本改走**用户真实路径**：让 `params` + `files` 两块同屏（`showMobilePanel` 是**累加**语义），
 * 在文件列表里长按某音频（>260ms 门槛）拖到参数面板上松手 —— 这正是 `PianoRollPanel` 监听
 * `hifi-file-drag` 的落点，导入成功会写进前端 store。
 *
 * 用法：node scripts/_dbg-import-drag.mjs [serial] [文件名关键字]
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const keyword = process.argv[3] ?? 'hs-tone';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
/* 🔴 默认走**鼠标**事件，不走触摸。原因（2026-10-01 实测）：
   CDP 的合成触摸会在**第一次 `pointermove`** 就被浏览器发 `pointercancel`（把手势当成
   列表滚动抢走）⇒ React 的 pointer 拖拽链路断掉，`hifi-file-drag` **一条都不派发**。
   鼠标不参与滚动抢手势，能干净地走完 `pointerdown → 长按 260ms → pointermove → pointerup`。
   加 `--touch` 可切回触摸（真机上人手触摸与 CDP 合成不同，值得对照）。 */
const useTouch = process.argv.includes('--touch');
try {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: useTouch, maxTouchPoints: 5 });
} catch {
    /* ignore */
}
const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
    });
const mouse = (type, x, y) =>
    cdp.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: type === 'mouseMoved' ? 'none' : 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
    });

/* 0.（仅 `--reset` 时）复位分屏比例。
   ⚠️ **默认不做**：`Page.reload` 会让 CDP 的 execution context 失效 —— 之后的
   `Runtime.evaluate` 落在**旧**上下文里，读什么都返回空（实测 `panes: []`，
   而同一时刻截屏里三个面板都在）。真机上的比例本就正常，不需要复位。 */
if (process.argv.includes('--reset')) {
    await cdp.call(() => {
        try {
            localStorage.setItem('hifishifter.mobileSplitRatio', '0.5');
        } catch {
            /* ignore */
        }
        return true;
    });
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.send('Runtime.enable');
    await sleep(12000);
}

/* 1. 让 **轨道 + 文件** 都在（`showMobilePanel` 是**累加**语义 ⇒ 派发即置 true；
   注意它**不会**把之前被关掉的面板打开，所以这里要显式派发 timeline）。 */
await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'timeline' } }));
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'files' } }));
    return true;
});
await sleep(2500);

/* 1b. 关掉**参数面板**（点它自己的 ✕），只留 **轨道 + 文件**：
   · 轨道面板**必须**在场 —— 音频 drop 的接收者是 `useTimelineDragDrop`（挂在 TimelinePanel 内）；
   · 参数面板对外来**音频**不接收（`PianoRollPanel` 的 `onHifiFileDrag` 只处理 MIDI）。 */
const closed = await cdp.call(() => {
    const btn = document.querySelector('[data-hs-pane="params"] .hs-panel-close');
    if (btn) {
        btn.click();
        return true;
    }
    return false;
});
console.log('▸ 关参数面板：' + closed);
await sleep(1800);

/* 2. 取坐标：目标文件行 + 参数面板中心 */
const geo = await cdp.call((kw) => {
    const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), top: Math.round(r.top), h: Math.round(r.height) };
    };
    const pane = (k) => {
        const el = document.querySelector(`[data-hs-pane="${k}"]`);
        return el ? rect(el) : null;
    };
    /* 目标行：文本以关键字开头、且**真的可见**（rect 落在文件面板可视区内）。
       ⚠️ 列表滚出面板的那部分仍在 DOM、`getBoundingClientRect()` 也照样给坐标，
       但坐标落在面板之外 ⇒ 按在那里什么都不会发生。实测就是踩了这个坑：
       取到的行 cy=658 而文件面板底边只有 644 ⇒ `onPointerDown` 从未触发 ⇒
       长按从未武装 ⇒ 后面的移动全被当成"滚动"丢弃、`hifi-file-drag` 一条都没有。 */
    const filesPane = document.querySelector('[data-hs-pane="files"]');
    const fr = filesPane ? filesPane.getBoundingClientRect() : null;
    const cands = [...document.querySelectorAll('[data-hs-pane="files"] *')].filter((el) => {
        const t = (el.textContent || '').trim();
        if (!t.startsWith(kw)) return false;
        if ([...el.children].some((c) => (c.textContent || '').trim().startsWith(kw))) return false;
        if (!fr) return false;
        const r = el.getBoundingClientRect();
        return r.top >= fr.top + 4 && r.bottom <= fr.bottom - 4;
    });
    /* 关键字找不到**可见**的行时，退回"面板内任意一个可见的音频文件行" ——
       造块只需要"随便一个音频"，不必是指定那一个。 */
    const anyAudio = [...document.querySelectorAll('[data-hs-pane="files"] *')].filter((el) => {
        const t = (el.textContent || '').trim();
        if (!/\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(t)) return false;
        if ([...el.children].some((c) => /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test((c.textContent || '').trim()))) return false;
        if (!fr) return false;
        const r = el.getBoundingClientRect();
        return r.top >= fr.top + 4 && r.bottom <= fr.bottom - 4;
    });
    const chosen = cands[0] ?? anyAudio[0];
    const rowEl = chosen ? (chosen.closest('.items-center') ?? chosen) : null;
    const row = rowEl ? { ...rect(rowEl), text: (rowEl.textContent || '').trim().slice(0, 40) } : null;
    return {
        kw,
        row,
        nameFound: Boolean(cands[0]),
        panes: [...document.querySelectorAll('[data-hs-pane]')].map((x) => x.getAttribute('data-hs-pane')),
        params: pane('params'),
        files: pane('files'),
        timeline: pane('timeline'),
        /* 诊断：文件页当前显示什么（目录不对时一眼看得出） */
        filesText: (document.querySelector('[data-hs-pane="files"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
    };
}, keyword);
console.log('▸ 几何：' + JSON.stringify(geo));

if (!geo.row) {
    console.log(`🔴 文件列表里找不到含「${keyword}」的行（可能目录不对）`);
    cdp.close();
    process.exit(1);
}
/* 落点优先**轨道面板** —— 音频导入的接收者 `useTimelineDragDrop` 在那儿；
   参数面板只收 MIDI，且它现在已被关掉。 */
const dest = geo.timeline ?? geo.params;
if (!dest) {
    console.log('🔴 参数面板 / 轨道面板都不在 ⇒ 无处可拖');
    cdp.close();
    process.exit(1);
}

/* 2b. 装事件记录器：确认拖拽究竟有没有被激活（`hifi-file-drag` 有没有派发、
   指针序列长什么样）。CDP 的 touch 会合成 pointer —— 若合成链路不完整，
   文件面板的 `pointerdown → 长按 → pointermove 激活` 这套就走不通。 */
await cdp.call(() => {
    const w = window;
    w.__dragLog = [];
    w.__ptrLog = [];
    w.addEventListener('hifi-file-drag', (e) => {
        try {
            w.__dragLog.push(e.detail?.type || '?');
        } catch {
            /* ignore */
        }
    });
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend']) {
        w.addEventListener(
            t,
            (e) => {
                if (w.__ptrLog.length < 80) {
                    w.__ptrLog.push(t + (e.pointerType ? ':' + e.pointerType : '') + (typeof e.button === 'number' ? ':b' + e.button : ''));
                }
            },
            true,
        );
    }
    return true;
});

/* 3. 触摸拖拽：先长按过 260ms 门槛，再移到目标面板松手 */
const x0 = geo.row.cx;
const y0 = geo.row.cy;
const x1 = dest.cx;
const y1 = dest.cy;
if (useTouch) {
    await touch('touchStart', [{ x: x0, y: y0 }]);
} else {
    await mouse('mousePressed', x0, y0);
}
await sleep(340);
for (let i = 1; i <= 8; i++) {
    const mx = Math.round(x0 + ((x1 - x0) * i) / 8);
    const my = Math.round(y0 + ((y1 - y0) * i) / 8);
    if (useTouch) await touch('touchMove', [{ x: mx, y: my }]);
    else await mouse('mouseMoved', mx, my);
    await sleep(60);
}
await sleep(200);
if (useTouch) await touch('touchEnd', []);
else await mouse('mouseReleased', x1, y1);
console.log(`▸ 拖拽完成（${useTouch ? '触摸' : '鼠标'}：${x0},${y0} → ${x1},${y1}），等导入…`);
await sleep(7000);

/* 4. 结果 */
const after = await cdp.call(() => ({
    panes: [...document.querySelectorAll('[data-hs-pane]')].map((x) => x.getAttribute('data-hs-pane')),
    quickActions: document.querySelectorAll('[data-hs-clip-actions]').length,
    bodyHasName: /hs-tone/i.test(document.body.innerText || ''),
    dragPayloadLeft: Boolean(window.__hsDragPayload),
    /* 关键诊断：拖拽事件序列 + 指针序列 */
    dragLog: (window.__dragLog || []).slice(0, 20),
    ptrSeq: (window.__ptrLog || []).slice(0, 40).join(' | '),
}));
console.log('▸ 结果：' + JSON.stringify(after));
try {
    const png = execSync(`adb -s ${serial} exec-out screencap -p`, { maxBuffer: 64 * 1024 * 1024 });
    writeFileSync('D:/Temp/after-import.png', png);
    console.log('▸ 截图：D:/Temp/after-import.png');
} catch (e) {
    console.log('截图失败：' + e.message);
}
cdp.close();
