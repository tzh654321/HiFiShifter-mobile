/* E34 诊断工具：**逐阶段打印拖动状态**（配合 `window.__hsDragDebug()` 插桩）。
   用途：拖动"被认出但不落地"时，一眼看出是哪一环 —— 原点有没有建立 / 参与者几个 /
   slip·copy / 交互锁计数 / 内核给的 deltaSec 是不是 0 / 这次到底是不是 `clip-drag`。
   用法：node scripts/_dbg-e34-drag-state.mjs [serial]
   配套判据：scripts/_probe-e34-drag-smooth.mjs（纪律见 docs/17「拖动类探针的四条纪律」）。 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
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
        touchPoints: pts.map((p) => ({
            id: 0,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 8,
            radiusY: 8,
            force: 1,
        })),
    });
const snap = async (tag) => {
    const d = await cdp.call(() => {
        const c = window.__hsClipProbe?.()?.clip;
        const dbg = window.__hsDragDebug?.() ?? null;
        const st = window.__hsDragStats?.();
        return {
            value: c ? +c.startSec.toFixed(4) : null,
            lock: dbg?.interactionLock,
            lockActive: dbg?.lockActive,
            multi: dbg?.multiSelected,
            hasOrigin: dbg?.hasOrigin,
            participants: dbg?.participants,
            lastDeltaStartSec: dbg?.lastDeltaStartSec,
            args: dbg?.lastArgs ? { d: +dbg.lastArgs.deltaSec.toFixed(4), n: dbg.lastArgs.n, alt: dbg.lastArgs.alt } : null,
            moves: st?.moves,
            previews: st?.previews,
        };
    });
    console.log(tag, JSON.stringify(d));
};
const bodyPoint = () =>
    cdp.call(() => {
        const c = window.__hsClipProbe?.()?.clip;
        const vp = window.__hsViewport?.();
        if (!c || !vp?.containerRect) return null;
        const r = vp.containerRect;
        const left = r.left + c.startSec * vp.pxPerSec - (vp.scrollLeft ?? 0);
        const ls = Math.max(left, r.left + 8);
        const rs = Math.min(left + c.lengthSec * vp.pxPerSec, r.left + r.width - 8);
        const rows = [...document.querySelectorAll('[data-hs-track-row]')].map((e) => {
            const rr = e.getBoundingClientRect();
            return Math.round(rr.top + rr.height / 2);
        });
        return { x: Math.round((ls + rs) / 2), y: rows[1] ?? rows[0] ?? Math.round(r.top + 40), rows };
    });

/* 先点选一个块（`__hsClipProbe` 只报当前选中块） */
{
    const sel = await cdp.call(() => window.__hsSelection?.() ?? null);
    if (!sel || (sel.multi?.length ?? 0) === 0) {
        const geo = await cdp.call(() => {
            const vp = window.__hsViewport?.();
            const rows = [...document.querySelectorAll('[data-hs-track-row]')].map((e) => {
                const rr = e.getBoundingClientRect();
                return Math.round(rr.top + rr.height / 2);
            });
            const r = vp.containerRect;
            return { rows, x: Math.round(r.left + r.width * 0.5) };
        });
        for (const y of geo.rows) {
            await touch('touchStart', [{ x: geo.x, y }]);
            await sleep(40);
            await touch('touchEnd', []);
            await sleep(350);
            const s2 = await cdp.call(() => window.__hsSelection?.() ?? null);
            if ((s2?.multi?.length ?? 0) > 0) {
                console.log(`▸ 已点选：行 y=${y}`);
                break;
            }
        }
    }
}

for (let round = 1; round <= 2; round += 1) {
    const p = await bodyPoint();
    if (!p) {
        console.log('没有可用的块身点');
        break;
    }
    console.log(`--- 第 ${round} 次拖动（起手 ${p.x},${p.y}，向左 36px） ---`);
    await snap('  起手前 ');
    await touch('touchStart', [{ x: p.x, y: p.y }]);
    await sleep(80);
    await snap('  按下后 ');
    for (let i = 1; i <= 6; i += 1) {
        await touch('touchMove', [{ x: p.x - i * 6, y: p.y }]);
        await sleep(14);
        if (i === 3) await snap('  第 3 帧 ');
    }
    await snap('  末帧   ');
    await touch('touchEnd', []);
    await sleep(1200);
    await snap('  抬手后 ');
}
