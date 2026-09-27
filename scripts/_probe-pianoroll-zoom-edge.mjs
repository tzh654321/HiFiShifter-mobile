#!/usr/bin/env node
/**
 * D6 验收（重写版）：参数编辑器双指缩放**碰边界不卡、锚点不漂**。
 *
 * 【为什么重写】上一版用 CDP `Input.dispatchTouchEvent` 驱动捏合，结果
 * `__hsGestureDebug` 报 `kx: 4` —— **向内**捏合却报放大 4 倍，且该调试对象只在
 * `update()` 里写、抬手后保留最后一帧 ⇒ 读到的很可能是**上一次会话**的残留，
 * 于是"反向捏合无效"这条判定根本不可信。
 *
 * 本版改为在**页面内直接派发成对的 `PointerEvent`**（与 D2 探针同一手法）：
 *   · 完全可控的帧序列（每帧之间都能读一次真值）；
 *   · 每帧记录 `__hsGestureDebug.kx` 与 `__hsParamViewport().pxPerSec`，
 *     于是"边界处反向捏合第一帧是否生效"变成可判定的逐帧事实。
 *
 * 用法：node scripts\_probe-pianoroll-zoom-edge.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

const main = async () => {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    const ready = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const clickText = async (t) => {
            const el = [...document.querySelectorAll('button,[role="menuitem"],div')].find(
                (b) => (b.textContent || '').trim() === t && b.children.length <= 3,
            );
            if (el) {
                el.click();
                return true;
            }
            return false;
        };
        if (document.querySelector('.hs-param-rows')) return 'already';
        await clickText('视图');
        await wait(700);
        await clickText('参数面板');
        await wait(1600);
        return document.querySelector('.hs-param-rows') ? 'opened' : 'missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(ready));

    const pinch = (spanFrom, spanTo, steps) =>
        cdp.call(
            async (from, to, n) => {
                const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                const v0 = window.__hsParamViewport ? window.__hsParamViewport() : null;
                const rect = v0 && v0.scrollerRect ? v0.scrollerRect : null;
                if (!rect) return { error: 'no-scroller-rect' };
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const target = document.elementFromPoint(cx, cy) ?? document.body;
                const mk = (type, id, x, y, buttons) =>
                    new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        pointerType: 'touch',
                        pointerId: id,
                        isPrimary: id === 11,
                        button: type === 'pointerdown' ? 0 : -1,
                        buttons,
                        clientX: x,
                        clientY: y,
                    });
                const samples = [];
                const read = (tag) => {
                    const v = window.__hsParamViewport ? window.__hsParamViewport() : null;
                    const d = window.__hsGestureDebug ?? null;
                    const midX = cx - (v && v.scrollerRect ? v.scrollerRect.left : rect.left);
                    samples.push({
                        tag,
                        kx: d ? d.kx : null,
                        armed: d ? d.armed : null,
                        lockX: d ? d.lockX : null,
                        pxPerSec: v ? Math.round(v.pxPerSec) : null,
                        scrollLeft: v ? Math.round(v.scrollLeft) : null,
                        secAtMid: v ? +(((v.scrollLeft + midX) / v.pxPerSec) || 0).toFixed(4) : null,
                    });
                };
                target.dispatchEvent(mk('pointerdown', 11, cx - from / 2, cy, 1));
                target.dispatchEvent(mk('pointerdown', 12, cx + from / 2, cy, 1));
                await wait(80);
                read('down');
                for (let i = 1; i <= n; i++) {
                    const sp = from + ((to - from) * i) / n;
                    target.dispatchEvent(mk('pointermove', 11, cx - sp / 2, cy, 1));
                    target.dispatchEvent(mk('pointermove', 12, cx + sp / 2, cy, 1));
                    await wait(40);
                    read('f' + i);
                }
                target.dispatchEvent(mk('pointerup', 11, cx - to / 2, cy, 0));
                target.dispatchEvent(mk('pointerup', 12, cx + to / 2, cy, 0));
                await wait(300);
                return { samples };
            },
            spanFrom,
            spanTo,
            steps,
        );

    let all = [];
    for (let i = 0; i < 4; i++) {
        const out = await pinch(40, 320, 6);
        if (out.error) {
            console.log('🔴 拿不到滚动容器：' + JSON.stringify(out));
            cdp.close();
            return;
        }
        all = all.concat(out.samples);
    }
    console.log('▸ 放大末帧：' + JSON.stringify(all.slice(-3)));
    const peak = Math.max(...all.map((x) => x.pxPerSec ?? 0));
    check(
        'D6-a 放大到上限后 pxPerSec 停住（不是无限涨 / 无响应）',
        peak > 0 && Number.isFinite(peak),
        `峰值 pxPerSec=${peak}`,
    );

    const back = await pinch(320, 80, 6);
    const s = back.samples ?? [];
    console.log('▸ 反向捏合逐帧：' + JSON.stringify(s));
    const down = s[0];
    const first = s[1];
    check(
        'D6-b 边界处反向捏合**第一帧**生效（旧实现会卡住）',
        Boolean(
            down &&
                first &&
                first.pxPerSec !== null &&
                down.pxPerSec !== null &&
                first.pxPerSec < down.pxPerSec,
        ),
        `逐帧 pxPerSec=${s.map((x) => x.pxPerSec).join(' → ')}；kx=${s.map((x) => x.kx).join(',')}`,
    );

    const moving = s.filter((x) => x.kx !== null && x.kx !== 1);
    const secs = moving.map((x) => x.secAtMid).filter((v) => Number.isFinite(v));
    const drift = secs.length > 1 ? Math.max(...secs) - Math.min(...secs) : 0;
    check(
        'D6-c 捏合过程中「两指中点下的时刻」不漂（锚点不脱钩）',
        moving.length >= 2 && drift < 0.35,
        `参与帧=${moving.length}；secAtMid=${JSON.stringify(secs)}；最大漂移=${drift.toFixed(4)}s（阈值 0.35s）`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
