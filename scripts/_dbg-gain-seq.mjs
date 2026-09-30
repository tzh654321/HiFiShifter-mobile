#!/usr/bin/env node
/**
 * E-GAIN 序列取证：**长按拖动 → 点别处 → 短按拖动**，全程带事件轨迹 + volume 采样。
 *
 * 目的：`_probe-gain-knob.mjs` 里 G1（长按拖动）✅ / G2·G3（点别处）✅ 但 **G5
 * （短按拖动）🔴 改了增益**；而**单独**跑短按（`_dbg-gain-gate.mjs`）又是 ✅。
 * ⇒ 说明是"长按那次拖动"留下的状态污染。本脚本把三步连起来跑，看污染发生在哪一步。
 *
 * 用法：node scripts/_dbg-gain-seq.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
            touchPoints: pts.map((p) => ({ id: p.id ?? 0, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });
    const vol = () =>
        cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {}).catch(() => null);
            return st?.tracks?.[0]?.volume ?? null;
        });
    const db = (v) => (v == null ? 'null' : (20 * Math.log10(Math.max(1e-9, v))).toFixed(2) + 'dB');
    const mark = (label, v) => console.log(`   ${label.padEnd(26)} volume=${String(v).padEnd(12)} ${db(v)}`);

    /* 先把增益复位到 0dB：双击旋钮 = 恢复 +0dB（E15）。 */
    const geo = await cdp.call(() => {
        const k = document.querySelector('[data-track-volume-knob]');
        const r = k.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await touch('touchStart', [{ x: geo.x, y: geo.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(90);
    await touch('touchStart', [{ x: geo.x, y: geo.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(900);
    console.log('▸ 复位后 ' + db(await vol()));

    /* 装轨迹（带时间戳） */
    await cdp.call(() => {
        window.__seq = [];
        const t0 = performance.now();
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            window.addEventListener(
                t,
                (e) =>
                    window.__seq.push({
                        t,
                        ms: Math.round(performance.now() - t0),
                        y: Math.round(e.clientY || 0),
                        id: e.pointerId,
                    }),
                true,
            );
        }
        return true;
    });

    console.log('\n【第①步】长按 420ms + 上拖 60px（应 = +12dB）');
    await touch('touchStart', [{ x: geo.x, y: geo.y }]);
    await sleep(420);
    for (let i = 1; i <= 6; i++) {
        await touch('touchMove', [{ x: geo.x, y: geo.y - (60 * i) / 6 }]);
        await sleep(40);
    }
    await touch('touchEnd', []);
    await sleep(900);
    const afterDrag = await vol();
    mark('长按拖动后', afterDrag);

    console.log('\n【第②步】在时间线空白轻点（不应改动）');
    const tl = await cdp.call(() => {
        const el = document.querySelector('[data-hs-surface="timeline"]');
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height - 80) };
    });
    await touch('touchStart', [{ x: tl.x, y: tl.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(900);
    const afterTap = await vol();
    mark('点时间线后', afterTap);

    console.log('\n【第③步】短按 120ms + 上拖 40px（门槛 260ms，不应改动）');
    await touch('touchStart', [{ x: geo.x, y: geo.y }]);
    await sleep(120);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ x: geo.x, y: geo.y - (40 * i) / 4 }]);
        await sleep(40);
        mark(`  第③步 move${i} 后`, await vol());
    }
    await touch('touchEnd', []);
    await sleep(1000);
    const afterShort = await vol();
    mark('短按拖动后', afterShort);

    /* 再点一次别处，看是否继续被改 */
    await touch('touchStart', [{ x: tl.x, y: tl.y }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(900);
    const afterTap2 = await vol();
    mark('再点时间线后', afterTap2);

    const seq = await cdp.call(() => window.__seq || []);
    console.log('\n▸ 事件轨迹：');
    for (const e of seq.slice(0, 80)) {
        console.log(`   ${String(e.ms).padStart(6)}ms  ${e.t.padEnd(14)} id=${String(e.id).padStart(4)} y=${e.y}`);
    }
    console.log('\n▸ 结论要点：');
    console.log('   ① 拖动=' + db(afterDrag) + '   ② 点别处=' + db(afterTap) + '   ③ 短按拖=' + db(afterShort) + '   ④ 再点别处=' + db(afterTap2));
    cdp.close();
};

await main();
