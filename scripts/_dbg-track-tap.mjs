#!/usr/bin/env node
/**
 * 微观诊断：轨道区「点空白」是否取消选中 / 是否移动播放头；轨道区「划动」是否平移。
 * 直接读 `selected_clip_id` 与 `playhead_sec`（后端真值）。
 *
 * 用法：node scripts/_dbg-track-tap.mjs [serial]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? '221deeb';
const WAV = 'D:\\Temp\\hs-tone.wav';

function st() {
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((s) => {
        const vp = window.__hsViewport();
        const raw = (s.clips || [])[0];
        const rowEl = raw ? document.querySelector(`[data-hs-track-row="${raw.track_id}"]`) : null;
        const rr = rowEl ? rowEl.getBoundingClientRect() : null;
        return {
            sel: s.selected_clip_id,
            playhead: +(s.playhead_sec ?? 0).toFixed(4),
            clips: (s.clips || []).length,
            scrollLeft: Math.round(vp.scrollLeft),
            container: vp.containerRect,
            rowTop: rr ? Math.round(rr.top) : null,
            rowHeight: rr ? Math.round(rr.height) : Math.round(vp.rowHeight),
            clipLeft: raw ? Math.round(vp.containerRect.left + raw.start_sec * vp.pxPerSec - vp.scrollLeft) : null,
            clipTop: rr ? Math.round(rr.top) : null,
            rows: document.querySelectorAll('[data-hs-track-row]').length,
        };
    });
}

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    await cdp.call(() => {
        const fire = (op) => window.dispatchEvent(new CustomEvent('hifi:timelineEditOp', { detail: { op } }));
        fire('selectAll');
        fire('delete');
    });
    await sleep(900);
    await cdp.call((b) => window.__hsImportAudioBase64('tap.wav', b, 0), readFileSync(WAV).toString('base64'));
    await sleep(1400);

    const g = await cdp.call(st);
    console.log('▸ 初始：' + JSON.stringify(g));

    /** 点上方是谁 + 可滚动范围（判断"没平移"是命中问题还是**没有可滚动量**）。 */
    const probePoint = (x, y) =>
        cdp.call(
            (ax, ay) => {
                const el = document.elementFromPoint(ax, ay);
                const sc = document.querySelector('[data-timeline-scroller="true"]');
                return {
                    at: el ? el.tagName + '.' + String(el.className).slice(0, 44) : null,
                    chain: el
                        ? (() => {
                              const out = [];
                              let cur = el;
                              for (let i = 0; i < 6 && cur; i++) {
                                  const r = cur.getBoundingClientRect();
                                  out.push(
                                      `${cur.tagName}${cur.id ? '#' + cur.id : ''}[${[...cur.attributes].map((a) => a.name).slice(0, 4).join(',')}] ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
                                  );
                                  cur = cur.parentElement;
                              }
                              return out;
                          })()
                        : null,
                    scrollWidth: sc ? sc.scrollWidth : null,
                    clientWidth: sc ? sc.clientWidth : null,
                    canScroll: sc ? sc.scrollWidth - sc.clientWidth : null,
                };
            },
            x,
            y,
        );
    console.log('▸ 划动起点探测：' + JSON.stringify(await probePoint(g.container.left + 180, Math.round(g.container.top + g.container.height - 20))));

    // ① 点块体（选中）
    const clipY = g.clipTop + Math.round(g.rowHeight * 0.65);
    await touch('touchStart', [{ id: 0, x: g.clipLeft + 60, y: clipY }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(600);
    console.log('▸ 点块体后：' + JSON.stringify(await cdp.call(st)));

    // ② 点下方空白轨道（应取消选中？不动播放头？）
    const blankY = Math.round(g.container.top + g.container.height - 20);
    const before = await cdp.call(st);
    await touch('touchStart', [{ id: 0, x: g.container.left + 150, y: blankY }]);
    await sleep(70);
    await touch('touchEnd', []);
    await sleep(700);
    const after = await cdp.call(st);
    console.log(
        `▸ 点空白 (${g.container.left + 150},${blankY})：sel ${before.sel} → ${after.sel}；播放头 ${before.playhead} → ${after.playhead}`,
    );

    // ③ 点块体上（已选中）再点空白以外的**轨道区**：看是否 seek
    // ④ 划动轨道区（空白）→ 应平移、不动播放头
    const b2 = await cdp.call(st);
    await touch('touchStart', [{ id: 0, x: g.container.left + 180, y: blankY }]);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ id: 0, x: g.container.left + 180 - (60 * i) / 4, y: blankY }]);
        await sleep(45);
    }
    await touch('touchEnd', []);
    await sleep(600);
    const a2 = await cdp.call(st);
    console.log(`▸ 划动空白轨道：scrollLeft ${b2.scrollLeft} → ${a2.scrollLeft}；播放头 ${b2.playhead} → ${a2.playhead}`);
    cdp.close();
};

await main();
