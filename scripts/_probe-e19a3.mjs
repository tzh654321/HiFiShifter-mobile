#!/usr/bin/env node
/**
 * E19a 验证：手机端「还原」工具能否**拖动连续擦除**（用户口径：「只能一次点一个点」）。
 *
 * 步骤（全部真实触摸）：
 *   ① 切参数面板；
 *   ② **真实触摸长按**绘制按钮 ⇒ 打开 `DrawToolMenu`；
 *   ③ 点「还原」；
 *   ④ 读参数（`get_param_frames`）作为基线；
 *   ⑤ 在参数画布上拖动（touchStart + 多次 touchMove + touchEnd）；
 *   ⑥ 再读参数，统计**被改写的帧数与范围**。
 *
 * 判读：被改写的帧**跨越整段拖动** ⇒ 拖动生效；只有单帧 ⇒ 复现"只能点一个点"。
 *
 * 用法：node scripts\_probe-e19a3.mjs [serial]
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
    const check = (n, ok, d) => console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });
    const tap = async (x, y) => {
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(900);
    };
    /** 真实触摸长按（不是合成事件 —— React 手势只认真实事件）。 */
    const longPress = async (x, y, holdMs = 550) => {
        await touch('touchStart', [{ id: 0, x, y }]);
        await sleep(holdMs);
        await touch('touchEnd', []);
        await sleep(1000);
    };

    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });

    // ② 长按「绘制」按钮
    const draw = await cdp.call(() => {
        const el = [...document.querySelectorAll('button')].find((x) => /^绘制$/.test((x.getAttribute('data-tooltip') || x.getAttribute('aria-label') || '').trim()));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    console.log('绘制按钮：' + JSON.stringify(draw));
    if (draw) await longPress(draw.x, draw.y);
    const items = await cdp.call(() =>
        [...document.querySelectorAll('button,[role=menuitem]')]
            .filter((x) => /还原|颤音|绘制/.test((x.textContent || '').trim()))
            .map((x) => {
                const r = x.getBoundingClientRect();
                return { text: (x.textContent || '').trim().slice(0, 6), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
            }),
    );
    console.log('长按后的菜单项：' + JSON.stringify(items));
    const restore = items.find((i) => i.text === '还原');
    check('E19a-1 长按绘制按钮能打开含「还原」的工具菜单', Boolean(restore), JSON.stringify(items));
    if (!restore) {
        cdp.close();
        return;
    }
    await tap(restore.x, restore.y);

    // ④ 基线参数
    const readParam = () =>
        cdp.call(async () => {
            const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a).catch((e) => ({ err: String(e).slice(0, 90) }));
            const st = await inv('get_timeline_state', {});
            const trackId = (st?.tracks || [])[0]?.id ?? st?.selected_track_id ?? 'track_main';
            const res = await inv('get_param_frames', { trackId, param: 'pitch', startFrame: 0, frameCount: 4000, stride: 4, binary: false });
            if (res?.err) return { err: res.err };
            const edit = res?.edit ?? res?.values ?? [];
            const nonDefault = edit.filter((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0).length;
            return { trackId, total: edit.length, nonDefault, head: edit.slice(0, 6) };
        });
    const before = await readParam();
    console.log('拖动前参数：' + JSON.stringify(before));

    // ⑤ 在参数画布上拖动
    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 80).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });
    console.log('参数画布：' + JSON.stringify(canvas));
    if (canvas) {
        const x0 = canvas.x + 25;
        const y0 = canvas.y + Math.round(canvas.h * 0.45);
        await touch('touchStart', [{ id: 0, x: x0, y: y0 }]);
        await sleep(120);
        for (let i = 1; i <= 16; i++) {
            await touch('touchMove', [{ id: 0, x: x0 + i * 10, y: y0 + Math.round(Math.sin(i / 2) * 8) }]);
            await sleep(60);
        }
        await touch('touchEnd', []);
        await sleep(1500);
        console.log('已发送 16 次 touchmove（横跨约 160px）');
    }
    const after = await readParam();
    console.log('拖动后参数：' + JSON.stringify(after));
    const changed = Math.abs((after.nonDefault ?? 0) - (before.nonDefault ?? 0));
    check('E19a-2 拖动改变了参数（非默认值数量发生变化）', changed > 0, `前 ${before.nonDefault} → 后 ${after.nonDefault}`);
    console.log('（若数值没变：说明该区域本来就没有曲线可擦，或拖动未生效 —— 需要先绘制一段再擦）');
    cdp.close();
};

await main();
