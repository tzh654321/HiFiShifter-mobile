#!/usr/bin/env node
/**
 * 诊断：CDP 的 `Input.dispatchTouchEvent` 在**多指**下怎么"抬手"才干净。
 *
 * 起因：E18 探针里后面几个用例（平移 / 惯性 / 单调）读数全是"零变化"，
 * 而调试钩子 `__hsGestureDebug.multi`（= 手势层手里的指针数 ≥ 3）恰好能区分
 * 「手指真的没动」和「**上一轮留下了没抬起来的陈旧指针**」——后者会让
 * `axisLockedX/Y` 同时为真 ⇒ 该会话既不缩放也不平移（这正好解释"零变化"）。
 *
 * 本脚本只做取证：同一次两指手势分别用两种抬手方式收尾，各读一次
 * `multi / armed / kx / ky` 与页面内记录的 pointer / touch 事件序列。
 *
 * 用法：node scripts/_dbg-e18-touch-end.mjs 221deeb
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function installRecorder() {
    window.__hsRec = [];
    const push = (e) => {
        window.__hsRec.push(
            [
                e.type,
                'id=' + (e.pointerId ?? '-'),
                'pt=' + (e.pointerType ?? '-'),
                'touches=' + (e.touches ? e.touches.length : '-'),
                'changed=' + (e.changedTouches ? e.changedTouches.length : '-'),
            ].join(' '),
        );
        if (window.__hsRec.length > 80) window.__hsRec.shift();
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        window.addEventListener(t, push, true);
    }
    return true;
}

function readState() {
    const d = window.__hsGestureDebug || null;
    const v = window.__hsParamViewport ? window.__hsParamViewport() : null;
    return {
        rec: (window.__hsRec || []).slice(-14),
        raw: window.__hsGestureDebug || null,
        multi: d ? d.multi : null,
        armed: d ? d.armed : null,
        kx: d ? d.kx : null,
        ky: d ? d.ky : null,
        nearX: d ? d.nearX : null,
        nearY: d ? d.nearY : null,
        active: window.__hsGestureActive === true,
        scrollLeft: v ? +v.scrollLeft.toFixed(2) : null,
        pxPerSec: v ? +v.pxPerSec.toFixed(2) : null,
        rowHeight: v ? +v.rowHeight.toFixed(4) : null,
        scroller: v && v.scrollerRect ? { l: v.scrollerRect.left, t: v.scrollerRect.top, w: v.scrollerRect.width, h: v.scrollerRect.height } : null,
    };
}

async function main() {
    const serial = process.argv[2] || '221deeb';
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
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 })),
        });

    await cdp.call(async () => {
        const w = (ms) => new Promise((r) => setTimeout(r, ms));
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await w(1200);
        return true;
    });
    await sleep(1200);
    await cdp.call(installRecorder);
    let st = await cdp.call(readState);
    console.log('▸ 面板：' + JSON.stringify({ scroller: st.scroller && { l: Math.round(st.scroller.l), t: Math.round(st.scroller.t), w: Math.round(st.scroller.w), h: Math.round(st.scroller.h) }, scrollLeft: st.scrollLeft, pxPerSec: st.pxPerSec, rowHeight: st.rowHeight }));
    const cx = Math.round(st.scroller.l + st.scroller.w / 2);
    const cy = Math.round(st.scroller.t + st.scroller.h / 2);

    /** 两指竖直捏合（+16px 越死区 +40px 再走），用 endMode 决定怎么抬手。 */
    async function pinch(endMode, shiftX = 0) {
        await cdp.call(() => {
            window.__hsRec = [];
            return true;
        });
        const p0 = { id: 0, x: cx - 60 + shiftX, y: cy - 20 };
        const p1 = { id: 1, x: cx + 60 + shiftX, y: cy + 20 };
        await touch('touchStart', [p0]);
        await sleep(140);
        await touch('touchStart', [p0, p1]);
        await sleep(140);
        p0.y -= 8;
        p1.y += 8; /* span +16：正好越过 16px 死区（中间帧只 +8） */
        await touch('touchMove', [p0, p1]);
        await sleep(200);
        const armed = await cdp.call(readState);
        for (let i = 0; i < 4; i++) {
            p0.y -= 5;
            p1.y += 5; /* 每步 span +10 ⇒ 共 +40 */
            await touch('touchMove', [p0, p1]);
            await sleep(150);
        }
        const during = await cdp.call(readState);
        if (endMode === 'empty') await touch('touchEnd', []);
        else await touch('touchEnd', [p0, p1]);
        await sleep(600);
        const after = await cdp.call(readState);
        return { armed, during, after };
    }

    for (const mode of ['empty', 'both']) {
        console.log(`\n=== 抬手方式：touchEnd ${mode === 'empty' ? '[]' : '[p0,p1]'} ===`);
        const r = await pinch(mode);
        console.log(
            '  armed 帧: ' + JSON.stringify({ multi: r.armed.multi, armed: r.armed.armed, scrollLeft: r.armed.scrollLeft, rowHeight: r.armed.rowHeight }),
        );
        console.log(
            '  拖动末:  ' + JSON.stringify({ multi: r.during.multi, kx: r.during.kx, ky: r.during.ky, nearX: r.during.nearX, nearY: r.during.nearY, rowHeight: r.during.rowHeight }),
        );
        console.log('  原始钩子: ' + JSON.stringify(r.during.raw));
        console.log(
            '  抬手后:  ' + JSON.stringify({ multi: r.after.multi, armed: r.after.armed, active: r.after.active, scrollLeft: r.after.scrollLeft, rowHeight: r.after.rowHeight }),
        );
        console.log('  事件序列（后 12 条）:');
        for (const line of r.after.rec) console.log('    ' + line);
        await sleep(600);
    }

    cdp.close();
}

await main();
