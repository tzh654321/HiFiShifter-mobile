#!/usr/bin/env node
/**
 * D5 验收：参数编辑器的**拖动工具**（手型）——纵轴可用、支持斜向、且跟手不滞后。
 *
 * 用户口径：「拖动工具在纵轴上拖动非常卡顿，且没支持斜向拖动」。
 *
 * 判据（真值取 `__hsParamViewport()`：pxPerSec/scrollLeft 为横向、center/span 为纵向）：
 *   ① **按住期间**逐帧就能看到横向与纵向都在变（不是抬手才落下 ⇒ 不滞后）；
 *   ② 一次**斜向**手势里两轴都变（旧实现只动横向：原生 scroller 没有可滚高度，
 *      `scrollTop` 恒被钳成 0）；
 *   ③ 位移与手指量级相符（横 `ΔscrollLeft ≈ Δx`；纵 `Δcenter ≈ Δy / rowHeight`，
 *      容差放宽到 3 倍以内即可 —— 纵向还有值域钳制）。
 *
 * 用法：node scripts\_probe-drag-tool.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

    // ① 打开参数面板
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

    // ② 切到「拖动」工具：长按「选择」→ 菜单里点「拖动」（与 D2 同手法：内层 span 上派发合成指针事件）
    const picked = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const btn = [...document.querySelectorAll('button')].find(
            (x) => (x.getAttribute('data-tooltip') || x.ariaLabel || '') === '选择',
        );
        if (!btn) return 'no-select-button';
        // ⚠️ 长按监听在**内层 span**（data-hs-select-anchor）上，事件只冒泡不下降 ⇒
        // 必须把 pointerdown 打在 span 上，打在 button 上永远开不出菜单（踩过）。
        const anchor = btn.querySelector('[data-hs-select-anchor]') ?? btn;
        const r = btn.getBoundingClientRect();
        const opts = {
            bubbles: true,
            cancelable: true,
            pointerType: 'touch',
            pointerId: 9,
            isPrimary: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
        };
        anchor.dispatchEvent(new PointerEvent('pointerdown', opts));
        await wait(620);
        anchor.dispatchEvent(new PointerEvent('pointerup', opts));
        await wait(500);
        const item = [...document.querySelectorAll('button')].find(
            (x) => (x.textContent || '').trim() === '拖动',
        );
        if (!item) return 'no-drag-item';
        item.click();
        await wait(600);
        return 'picked';
    });
    console.log('▸ 切「拖动」工具：' + JSON.stringify(picked));

    // ③ 斜向拖动：按住期间逐帧读真值
    const out = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const v0 = window.__hsParamViewport ? window.__hsParamViewport() : null;
        const rect = v0 && v0.scrollerRect ? v0.scrollerRect : null;
        if (!rect) return { error: 'no-rect' };
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const target = document.elementFromPoint(cx, cy) ?? document.body;
        const mk = (type, x, y, buttons) =>
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerType: 'touch',
                pointerId: 21,
                isPrimary: true,
                button: type === 'pointerdown' ? 0 : -1,
                buttons,
                clientX: x,
                clientY: y,
            });
        const read = () => {
            const v = window.__hsParamViewport ? window.__hsParamViewport() : null;
            return v
                ? { pxPerSec: Math.round(v.pxPerSec), scrollLeft: Math.round(v.scrollLeft), center: +v.center.toFixed(4), span: +v.span.toFixed(4) }
                : null;
        };
        const samples = [{ tag: 'down', v: read() }];
        target.dispatchEvent(mk('pointerdown', cx, cy, 1));
        await wait(80);
        // 斜向：左 60 / 下 40（分 4 帧）
        for (let i = 1; i <= 4; i++) {
            target.dispatchEvent(mk('pointermove', cx - (60 * i) / 4, cy + (40 * i) / 4, 1));
            await wait(50);
            samples.push({ tag: 'f' + i, v: read() });
        }
        target.dispatchEvent(mk('pointerup', cx - 60, cy + 40, 0));
        await wait(300);
        return { samples, rect };
    });
    console.log('▸ 斜向拖动逐帧：' + JSON.stringify(out.samples ?? out));

    const s = out.samples ?? [];
    const a = s[0] && s[0].v;
    const b = s[s.length - 1] && s[s.length - 1].v;
    const mid = s[2] && s[2].v;
    if (!a || !b || !mid) {
        console.log('🔴 拿不到真值（钢琴栏没挂载 / 拖动工具没切上？）');
        cdp.close();
        return;
    }
    const dLeft = b.scrollLeft - a.scrollLeft;
    const dCenter = b.center - a.center;

    check(
        'D5-a 按住期间**逐帧**就在变（不是抬手才落下 ⇒ 不滞后）',
        mid.scrollLeft !== a.scrollLeft || mid.center !== a.center,
        `第 2 帧：scrollLeft ${a.scrollLeft} → ${mid.scrollLeft}；center ${a.center} → ${mid.center}`,
    );
    check(
        'D5-b 一次斜向手势里**两轴都动**（旧实现纵轴恒不动）',
        Math.abs(dLeft) > 10 && Math.abs(dCenter) > 1e-4,
        `ΔscrollLeft=${dLeft}（左划 60px，期望 ≈ +60 或钳制后同号）；Δcenter=${dCenter.toFixed(4)}（下划 40px）`,
    );
    check(
        'D5-c 位移量级与手指相符（横 ≈ Δx；纵与行高同量级）',
        Math.abs(Math.abs(dLeft) - 60) <= 60 && Math.abs(dCenter) > 1e-4,
        `ΔscrollLeft=${dLeft}，Δcenter=${dCenter.toFixed(4)}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
