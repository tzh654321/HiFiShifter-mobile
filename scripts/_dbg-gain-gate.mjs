#!/usr/bin/env node
/**
 * E-GAIN 门槛取证：**短按（<260ms 门槛）+ 拖动**到底有没有偷偷进入拖动。
 *
 * 背景：`_probe-gain-knob.mjs` 的 G5 用例发现「短按 120ms 后上拖 40px」把 volume
 * 从 12dB 改成了 4dB —— 而 `beginVolumeKnobDrag` 的设计是"按住 260ms 才生效，
 * 期间位移 >10px 即放弃"。本脚本带**带时间戳的事件轨迹** + 逐帧 volume 采样，
 * 把"门槛有没有被绕过"与"到底是谁在改 volume"分开看。
 *
 * 用法：node scripts/_dbg-gain-gate.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const HOLD = Number(process.env.HOLD_MS ?? 120);
const STEP = Number(process.env.STEP_PX ?? 10);
const STEPS = Number(process.env.STEPS ?? 4);

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

    const info = await cdp.call(() => {
        const k = document.querySelector('[data-track-volume-knob]');
        const v = document.querySelector('[data-track-gain-value]');
        const r = k.getBoundingClientRect();
        window.__hsEv = [];
        const t0 = performance.now();
        for (const t of [
            'pointerdown',
            'pointermove',
            'pointerup',
            'pointercancel',
            'touchstart',
            'touchmove',
            'touchend',
            'touchcancel',
        ]) {
            window.addEventListener(
                t,
                (e) =>
                    window.__hsEv.push({
                        t,
                        ms: Math.round(performance.now() - t0),
                        x: Math.round(e.clientX || 0),
                        y: Math.round(e.clientY || 0),
                        id: e.pointerId,
                        pt: e.pointerType || 'touch',
                    }),
                true,
            );
        }
        return {
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            knob: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            labelBefore: v ? (v.textContent || '').trim() : null,
        };
    });
    console.log('▸ 旋钮 ' + JSON.stringify(info.knob) + '  中心=(' + info.x + ',' + info.y + ')  标签=' + info.labelBefore);
    console.log('▸ 起始 volume=' + (await vol()) + '  参数：按住 ' + HOLD + 'ms → ' + STEPS + ' 步 × ' + STEP + 'px → 抬手');

    const samples = [];
    await touch('touchStart', [{ x: info.x, y: info.y }]);
    await sleep(HOLD);
    samples.push({ at: `hold${HOLD}`, v: await vol() });
    for (let i = 1; i <= STEPS; i++) {
        await touch('touchMove', [{ x: info.x, y: info.y - i * STEP }]);
        await sleep(40);
        samples.push({ at: `move${i}`, v: await vol() });
    }
    await touch('touchEnd', []);
    await sleep(1200);
    const after = await vol();
    const ev = await cdp.call(() => window.__hsEv || []);
    const label = await cdp.call(() => {
        const v = document.querySelector('[data-track-gain-value]');
        return v ? (v.textContent || '').trim() : null;
    });

    console.log('\n▸ 逐帧 volume：' + JSON.stringify(samples));
    console.log('▸ 抬手后 volume=' + after + '  标签=' + label);
    console.log('\n▸ 事件轨迹（ms 相对脚本安装时刻，y 是屏幕坐标）：');
    for (const e of ev.slice(0, 40)) {
        console.log(`   ${String(e.ms).padStart(6)}ms  ${e.t.padEnd(14)} id=${String(e.id).padStart(3)} ${e.pt.padEnd(5)} (${e.x},${e.y})`);
    }
    const hasTouchMove = ev.some((e) => e.t === 'touchmove');
    const hasCancel = ev.some((e) => e.t === 'pointercancel');
    console.log('\n判读要点：');
    console.log('· 短按门槛若被绕过 ⇒ 第一次 move 后 volume 就会变（本用例按设计应**全程不变**）');
    console.log('· touchmove 存在=' + hasTouchMove + '  pointercancel 存在=' + hasCancel);
    cdp.close();
};

await main();
