#!/usr/bin/env node
/**
 * E-GAIN 取证/验收：**增益旋钮拖完之后，"点别处"不该还在调增益**。
 *
 * 用户原话（2026-09-30）：「轨道头的增益调完之后点击别处仍被判定在调增益」。
 *
 * 手法：真机 CDP 触摸复现（`data-track-volume-knob` 上长按 420ms 越过 260ms 门槛
 * → 上拖 60px ⇒ 期望 +12dB（`TRACK_GAIN_DRAG_DB_PER_PX = 0.2`）→ 抬手），
 * 然后**在别处轻点**，读后端 `track.volume` 是否被改动。
 *
 * 用法：node scripts/_probe-gain-knob.mjs --serial 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: '221deeb', port: 9222, hold: 420, dy: 60 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--hold') o.hold = Number(argv[++i]);
        else if (a === '--dy') o.dy = Number(argv[++i]);
    }
    return o;
}

/** 页面内：读旋钮几何 + 后端轨道音量（权威）+ 增益标签文本。 */
function inPageProbe() {
    const el = document.querySelector('[data-track-volume-knob]');
    if (el === null) return { error: 'no-gain-knob' };
    const r = el.getBoundingClientRect();
    const tracks = [...document.querySelectorAll('[data-track-volume-control]')].map((n) => {
        const rr = n.getBoundingClientRect();
        return { id: n.getAttribute('data-track-id'), rect: { l: Math.round(rr.left), t: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) } };
    });
    const label = document.querySelector('[data-track-gain-value]');
    const tl = document.querySelector('[data-hs-surface="timeline"]');
    const tlRect = tl ? tl.getBoundingClientRect() : null;
    return window.__TAURI_INTERNALS__.invoke('get_timeline_state').then((st) => {
        const t0 = (st.tracks || [])[0] || {};
        return {
            knob: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) },
            volume: t0.volume,
            trackKeys: Object.keys(t0),
            gainLabel: label ? (label.textContent || '').trim() : null,
            trackIds: tracks.map((t) => t.id),
            timeline: tlRect ? { l: Math.round(tlRect.left), t: Math.round(tlRect.top), w: Math.round(tlRect.width), h: Math.round(tlRect.height) } : null,
            /** 增益提示浮层是否仍挂着（收尾不干净时会常驻）。 */
            tooltipVisible: !!document.querySelector('[data-track-volume-tooltip]'),
        };
    });
}

async function main() {
    const o = parseArgs(process.argv);
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

    const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: points.map((p) => ({ id: 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const probe = () => cdp.call(inPageProbe);
    const tap = async (x, y, hold = 60) => {
        await touch('touchStart', [{ x, y }]);
        await sleep(hold);
        await touch('touchEnd', []);
        await sleep(700);
    };

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    let g0 = await probe();
    if (g0.error) throw new Error(JSON.stringify(g0));
    console.log('▸ 初始：' + JSON.stringify({ knob: g0.knob, volume: g0.volume, gainLabel: g0.gainLabel }));
    console.log('▸ 轨道字段：' + JSON.stringify(g0.trackKeys) + '  轨道数=' + g0.trackIds.length);
    if (g0.volume === undefined) {
        console.log('⚠️ `track.volume` 字段名不对，探针无法判定——先修字段名。');
        cdp.close();
        return;
    }

    /* ── G1：长按 420ms（越过 260ms 门槛）+ 上拖 60px ⇒ 期望 +12dB ────────── */
    {
        const k = g0.knob;
        await touch('touchStart', [{ x: k.x, y: k.y }]);
        await sleep(o.hold);
        for (let i = 1; i <= 6; i++) {
            await touch('touchMove', [{ x: k.x, y: k.y - (o.dy * i) / 6 }]);
            await sleep(45);
        }
        await touch('touchEnd', []);
        await sleep(900);
        const g1 = await probe();
        const db = 20 * Math.log10(Math.max(1e-6, g1.volume));
        check(
            `G1 长按 ${o.hold}ms + 上拖 ${o.dy}px ⇒ 增益变化（期望 ≈ +${(o.dy * 0.2).toFixed(1)}dB）`,
            Math.abs(db - o.dy * 0.2) <= 2.5,
            `volume ${g0.volume} → ${g1.volume}（${db.toFixed(2)}dB）  标签=${g1.gainLabel}  提示浮层=${g1.tooltipVisible}`,
        );

        /* ── G2：随后在**时间线空白**轻点 ⇒ 增益必须不变 ─────────────────── */
        const before2 = g1.volume;
        const tl = g1.timeline;
        await tap(Math.round(tl.l + tl.w / 2), Math.round(tl.t + tl.h - 60));
        const g2 = await probe();
        check(
            'G2 拖完后在时间线空白轻点 ⇒ 增益**不得**被改动',
            Math.abs(g2.volume - before2) < 1e-4,
            `volume ${before2} → ${g2.volume}（差 ${(g2.volume - before2).toExponential(2)}）`,
        );

        /* ── G3：随后在**轨道头别处**（轨道名）轻点 ⇒ 增益必须不变 ───────── */
        const ctl = (await cdp.call(() => {
            const n = document.querySelector('[data-track-volume-control]');
            const r = n.getBoundingClientRect();
            return { x: Math.round(r.left + r.width - 12), y: Math.round(r.top + 8) };
        }));
        await tap(ctl.x, ctl.y);
        const g3 = await probe();
        check(
            'G3 拖完后在轨道头别处轻点 ⇒ 增益**不得**被改动',
            Math.abs(g3.volume - before2) < 1e-4,
            `volume ${before2} → ${g3.volume}  点=(${ctl.x},${ctl.y})`,
        );

        /* ── G4：拖动**过程中**是否与轨道头其它手势串味（记录信息）────────── */
        console.log(`▸ 拖动后提示浮层是否残留：G1=${g1.tooltipVisible} G2=${g2.tooltipVisible} G3=${g3.tooltipVisible}`);

        /* ── G6（E15）：**从非 0 复位** —— 双击旋钮回到 0dB ────────────────────
         *
         * 这条一直挂在"⚠️ 判据受限"里：以前 E11-b 让增益根本调不离 0，
         * 双击"回到 0"这件事无法与"本来就在 0"区分。现在 G1 已经能稳定把增益
         * 推到 +12dB，所以从这里双击才构成**强验证**。
         *
         * ⚠️ 必须用**真触摸双击**（两次 touchStart/End，间隔 ~90ms）——
         * 合成 `dblclick` 只能证明"处理函数挂着"，证明不了"手机上打得中"。
         * 若真触摸双击无效，再补一次合成 dblclick 以区分"handler 缺失"与
         * "WebView 不给触摸合成 dblclick"。
         */
        {
            const g = await probe();
            const before = g.volume;
            const k = g.knob;
            const dblTap = async () => {
                await touch('touchStart', [{ x: k.x, y: k.y }]);
                await sleep(70);
                await touch('touchEnd', []);
                await sleep(90);
                await touch('touchStart', [{ x: k.x, y: k.y }]);
                await sleep(70);
                await touch('touchEnd', []);
                await sleep(900);
            };
            await dblTap();
            const after = await probe();
            const dbAfter = 20 * Math.log10(Math.max(1e-6, after.volume));
            const okTouch = Math.abs(dbAfter) <= 0.6;
            check(
                'G6（E15）**从非 0 复位**：真触摸双击旋钮 ⇒ 增益回到 0dB',
                okTouch,
                `volume ${before}（${(20 * Math.log10(Math.max(1e-6, before))).toFixed(2)}dB）→ ${after.volume}（${dbAfter.toFixed(2)}dB）  标签=${after.gainLabel}`,
            );
            if (!okTouch) {
                /* 区分两种失败：① handler 没挂（合成也无效）② 触摸没合成出 dblclick。 */
                await cdp.call(() => {
                    const el = document.querySelector('[data-track-volume-knob]');
                    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                    return true;
                });
                await sleep(800);
                const syn = await probe();
                check(
                    'G6b 合成 dblclick 是否有效（区分「handler 缺失」/「触摸不合成 dblclick」）',
                    true,
                    `合成后 volume=${syn.volume}（${(20 * Math.log10(Math.max(1e-6, syn.volume))).toFixed(2)}dB）—— ` +
                        `若这里也非 0 ⇒ handler 缺失；若这里回到 0 ⇒ 只是触摸路径没合成 dblclick`,
                );
            }
        }
    }

    /* ── G5：短按（<门槛）后拖动 ⇒ 不该改增益（门槛生效）───────────────── */
    {
        const g = await probe();
        const before = g.volume;
        const k = g.knob;
        await touch('touchStart', [{ x: k.x, y: k.y }]);
        await sleep(120); /* < 260ms 门槛 */
        for (let i = 1; i <= 4; i++) {
            await touch('touchMove', [{ x: k.x, y: k.y - (40 * i) / 4 }]);
            await sleep(30);
        }
        await touch('touchEnd', []);
        await sleep(800);
        const after = await probe();
        check(
            'G5 短按（<260ms 门槛）后拖动 ⇒ 增益不得变化（门槛仍在生效）',
            Math.abs(after.volume - before) < 1e-4,
            `volume ${before} → ${after.volume}`,
        );
    }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== 增益旋钮探针：通过 ${pass} / ${results.length} ===`);
    for (const r of results) console.log(`${r.ok ? '✅' : '🔴'} ${r.name}`);
    cdp.close();
    process.exit(pass === results.length ? 0 : 1);
}

await main();
