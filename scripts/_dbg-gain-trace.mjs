#!/usr/bin/env node
/**
 * E11-b 细诊断：长按后拖动**过程中**逐帧读 track.volume，判断问题在哪一层。
 *
 * 前情：已修三层（① 去掉 `startVolumeKnobDragNow` 对 touch 的早退；② 门槛阶段挂非被动
 * `touchmove` 阻止；③ 改原生 touch 驱动 + `pointercancel` 不再收尾），`volume` 仍是 1。
 * 本脚本把"拖动过程中 store 有没有变"与"松手后有没有提交"分开看。
 *
 * 用法：node scripts\_dbg-gain-trace.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
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
    const vol = () =>
        cdp.call(async () => {
            const st = await window.__TAURI_INTERNALS__.invoke('get_timeline_state', {}).catch(() => null);
            return st?.tracks?.[0]?.volume ?? null;
        });

    const knob = await cdp.call(() => {
        const k = document.querySelector('[data-track-volume-knob]');
        if (!k) return null;
        const r = k.getBoundingClientRect();
        // 顺带记录事件序列，判断 touch 路径是否真的在跑
        if (!window.__hsEv) {
            window.__hsEv = [];
            for (const t of ['pointerdown', 'pointermove', 'pointercancel', 'touchstart', 'touchmove', 'touchend']) {
                window.addEventListener(t, () => window.__hsEv.push(t), true);
            }
        }
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (!knob) {
        console.log('🔴 找不到增益旋钮');
        return;
    }
    console.log('旋钮：' + JSON.stringify(knob) + '  起始 volume=' + (await vol()));

    // 长按 360ms 后**缓慢**上划（每帧读一次 volume）
    await touch('touchStart', [{ id: 0, x: knob.x, y: knob.y }]);
    await sleep(380);
    const during = [];
    for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [{ id: 0, x: knob.x, y: knob.y - i * 6 }]);
        await sleep(90);
        during.push(await vol());
    }
    await touch('touchEnd', []);
    await sleep(1200);
    const after = await vol();
    const ev = await cdp.call(() => window.__hsEv || []);

    console.log('拖动过程中 volume 采样：' + JSON.stringify(during));
    console.log('松手后 volume = ' + after);
    console.log('事件序列：' + JSON.stringify(ev));
    console.log('\n判读：');
    console.log('· 若 during 有变化 ⇒ 拖动生效，只是"提交"没落库（查 onVolumeCommit）');
    console.log('· 若 during 全为 1 且事件序列里只有 pointer* 没有 touch* ⇒ 触摸路径没进');
    console.log('· 若事件序列里有 pointercancel 而 touch* 缺失 ⇒ 浏览器接管了手势');
    cdp.close();
};

await main();
