#!/usr/bin/env node
/**
 * E19a 诊断：参数画布上的拖动，指针事件**到底走到哪一步**。
 *
 * 【为什么需要】`_probe-e19a-done.mjs` 实测拖动后 Δ0（擦除没生效）。
 * 但"没生效"有至少三种完全不同的成因，光看 Δ0 分不出：
 *   a) 事件压根没到宿主（落在覆盖层 / 被 pointercancel 抢走）；
 *   b) 到了但被 `buttons` 位掩码之类的守卫丢掉；
 *   c) 到了、也改了前端状态，但**没提交到后端**（`get_param_frames` 读的是后端）。
 * ⇒ 先把**原始事件序列**打出来：类型 / `pointerType` / `buttons` / 命中元素。
 *
 * 用法：node scripts/_dbg-e19a-events.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
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
        touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
    });

await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    await new Promise((r) => setTimeout(r, 2600));
});

/* 关键：把 `invoke` 包一层，记录"拖动过程中前端到底向后端提交了什么"。
   光看 Δ0 分不出"守卫拦掉 / 提交到别的轨道 / 压根没调"三种成因。

   ⚠️ 要挂 **`__TAURI__.core.invoke`**：应用自己的 `services/invoke.ts` 走的是
   这个（每次调用时现读），**不是** `__TAURI_INTERNALS__.invoke`（那是探针直调用的）。
   先挂错对象 ⇒ 日志恒 0 条，会误判成"没提交"。两个都挂上。 */
await cdp.call(() => {
    const w = window;
    w.__e19inv = [];
    const wrap = (obj, key) => {
        if (!obj || typeof obj[key] !== 'function') return false;
        const orig = obj[key];
        obj[key] = function (cmd, args) {
            try {
                const a = args || {};
                if (/param|edit|commit/.test(String(cmd))) {
                    const head = {};
                    for (const k of ['trackId', 'param', 'startFrame', 'frameCount', 'checkpoint']) {
                        if (k in a) head[k] = a[k];
                    }
                    if (Array.isArray(a.values)) head.valuesLen = a.values.length;
                    w.__e19inv.push(String(cmd) + ' ' + JSON.stringify(head));
                }
            } catch {
                /* ignore */
            }
            return orig.call(this, cmd, args);
        };
        return true;
    };
    const hits = [
        wrap(w.__TAURI__?.core, 'invoke'),
        wrap(w.__TAURI__, 'invoke'),
        wrap(w.__TAURI_INTERNALS__, 'invoke'),
    ];
    w.__e19invHooks = hits;
    return hits;
}).then((h) => console.log('▸ invoke 包装：' + JSON.stringify(h)));

/* 同时抓 console.error / unhandledrejection —— `invoke.ts` 失败时会走
   `console.error("Tauri invoke failed", …)`，那是"提交了但后端报错"的铁证。 */
await cdp.call(() => {
    const w = window;
    w.__e19err = [];
    const ce = console.error.bind(console);
    console.error = (...a) => {
        try {
            if (w.__e19err.length < 30) w.__e19err.push(a.map((x) => String(x && x.message ? x.message : x).slice(0, 160)).join(' | '));
        } catch {
            /* ignore */
        }
        return ce(...a);
    };
    w.addEventListener('unhandledrejection', (e) => {
        try {
            w.__e19err.push('unhandledrejection: ' + String(e.reason).slice(0, 200));
        } catch {
            /* ignore */
        }
    });
    return true;
});

await cdp.call(() => {
    const w = window;
    w.__e19log = [];
    const evs = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend'];
    const host = (el) => {
        if (!el || !el.getAttribute) return '?';
        if (el.getAttribute('data-piano-roll-canvas') !== null) return 'prCanvas';
        const pane = el.closest && el.closest('[data-hs-pane]');
        return (pane ? pane.getAttribute('data-hs-pane') : el.tagName) || el.tagName;
    };
    w.__e19h = (e) => {
        if (w.__e19log.length > 150) return;
        w.__e19log.push(
            `${e.type}${e.pointerType ? ':' + e.pointerType : ''}${typeof e.buttons === 'number' ? ':b' + e.buttons : ''}@${host(e.target)}`,
        );
    };
    for (const t of evs) w.addEventListener(t, w.__e19h, true);
    return true;
});
console.log('▸ 监听已装');

const geo = await cdp.call(() => {
    const el = document.querySelector('[data-piano-roll-canvas]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log('▸ 参数画布：' + JSON.stringify(geo));
if (!geo) {
    cdp.close();
    process.exit(1);
}

/* 写一条可见的基线 + 读参数的工具：用来判断"提交链路"本身是否通
   （默认是「绘制」模式 ⇒ 拖动应当**写入**参数；restore 则会擦除）。 */
const FRAMES = 1200;
const tk = await cdp.call(async () => {
    const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch(() => null);
    const st = await inv('get_timeline_state', {});
    const trackId = (st?.clips || [])[0]?.track_id ?? 'track_main';
    await inv('set_track_state', { trackId, composeEnabled: true });
    await new Promise((r) => setTimeout(r, 1200));
    const values = Array.from({ length: 1200 }, (_, i) => Math.sin(i / 30) * 250);
    await inv('set_param_frames', { trackId, param: 'pitch', startFrame: 0, values, checkpoint: false });
    await new Promise((r) => setTimeout(r, 1500));
    return trackId;
});
console.log('▸ 轨道：' + tk);
const readParam = () =>
    cdp.call(async (trackId) => {
        const res = await window.__TAURI_INTERNALS__.invoke('get_param_frames', {
            trackId,
            param: 'pitch',
            startFrame: 0,
            frameCount: 1200,
            stride: 1,
        }).catch(() => null);
        const edit = Array.isArray(res?.edit) ? res.edit : [];
        let nz = 0;
        for (const v of edit) if (typeof v === 'number' && Number.isFinite(v) && v !== 0) nz += 1;
        return nz;
    }, tk);
const before = await readParam();
console.log('▸ 拖动前非零帧：' + before);

const x0 = geo.x - 100;
const y0 = geo.y;
await cdp.call(() => {
    window.__e19inv = [];
    return true;
});
await touch('touchStart', [{ x: x0, y: y0 }]);
await sleep(130);
for (let i = 1; i <= 20; i++) {
    await touch('touchMove', [{ x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 8) }]);
    await sleep(45);
}
await touch('touchEnd', []);
await sleep(600);

const after = await readParam();
console.log(`▸ 拖动后非零帧：${after}（Δ=${after - before}）`);

const log = await cdp.call(() => {
    const l = window.__e19log || [];
    const counts = {};
    for (const e of l) {
        const k = e.split('@')[0];
        counts[k] = (counts[k] || 0) + 1;
    }
    return { counts, first: l.slice(0, 14), total: l.length };
});
console.log('▸ 事件计数：' + JSON.stringify(log.counts));
console.log('▸ 前 14 条：');
for (const e of log.first) console.log('   ' + e);

const invLog = await cdp.call(() => window.__e19inv || []);
console.log('▸ 拖动期间前端提交的参数类 IPC 共 ' + invLog.length + ' 条：');
for (const l of invLog.slice(0, 12)) console.log('   ' + l);

const errLog = await cdp.call(() => window.__e19err || []);
console.log('▸ console.error / 未处理拒绝 共 ' + errLog.length + ' 条：');
for (const l of errLog.slice(0, 10)) console.log('   ' + l);
cdp.close();
