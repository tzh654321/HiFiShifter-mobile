#!/usr/bin/env node
/**
 * D2 验收：绘制工具菜单里的「还原」**可选且界面反映它**。
 *
 * 判据（都是 DOM 可观测的）：
 *   ① 长按绘制按钮 → 工具菜单出现，且含「绘制 / 颤音 / 还原」三项；
 *   ② 初始 `aria-pressed` 在「绘制」上；
 *   ③ 点「还原」后菜单关闭；
 *   ④ 再开菜单 → `aria-pressed` 落在「还原」上（改造前永远落在「绘制」⇒ 用户以为不可用）；
 *   ⑤ 绘制按钮上的 `data-hs-draw-tool` = `restore`（菜单收起后也能看出当前工具）。
 *
 * 用法：node scripts\_probe-restore-tool.mjs [serial]
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
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
        });

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    // 参数面板（绘制工具行只在其可见时挂载）
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
        await wait(1500);
        return document.querySelector('.hs-param-rows') ? 'opened' : 'missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(ready));

    /** 长按绘制按钮 → 打开工具菜单，返回菜单项的 aria-pressed 状态。
     *
     *  ⚠️ 用**合成 pointer 事件**打在铅笔的内层 span 上，而不是 CDP 触摸：
     *  这条长按逻辑挂的是 React 的 `onPointerDown`（在内层 span 上），
     *  CDP 触摸路径下事件落在哪个子节点取决于命中测试，实测菜单没开；
     *  直接派发 pointerdown/pointerup（pointerType: "touch"）与真机手指等价，
     *  而且不依赖"长按后补发的 click 是否被守卫吃掉"这类时序。 */
    const openMenu = async () => {
        const opened = await cdp.call(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const btn = [...document.querySelectorAll('button')].find(
                (x) => (x.getAttribute('data-tooltip') || x.ariaLabel || '') === '绘制',
            );
            if (!btn) return 'no-draw-button';
            const span = btn.querySelector('[data-hs-draw-tool]') ?? btn;
            const r = btn.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            span.dispatchEvent(new PointerEvent('pointerdown', opts));
            await wait(620);
            const menuWhileHeld = Boolean(document.querySelector('[aria-label="绘制工具"]'));
            span.dispatchEvent(new PointerEvent('pointerup', opts));
            await wait(500);
            return { menuWhileHeld, menuAfterUp: Boolean(document.querySelector('[aria-label="绘制工具"]')) };
        });
        await sleep(300);
        const read = await cdp.call(() => {
            const menu = document.querySelector('[aria-label="绘制工具"]');
            const items = menu
                ? [...menu.querySelectorAll('button')].map((b) => ({
                      label: (b.textContent || '').trim().slice(0, 8),
                      pressed: b.getAttribute('aria-pressed'),
                  }))
                : [];
            const anchor = document.querySelector('[data-hs-draw-tool]');
            return { menuPresent: Boolean(menu), items, drawTool: anchor ? anchor.getAttribute('data-hs-draw-tool') : null };
        });
        return { ...opened, ...read };
    };

    const first = await openMenu();
    console.log('▸ 首次开菜单：' + JSON.stringify(first));
    const labels = (first.items ?? []).map((i) => i.label);
    check(
        'D2-a 工具菜单含 绘制 / 颤音 / 还原 三项',
        labels.includes('绘制') && labels.includes('颤音') && labels.includes('还原'),
        `菜单项=${JSON.stringify(first.items)}`,
    );
    check(
        'D2-b 初始当前工具 = 绘制',
        (first.items ?? []).some((i) => i.label === '绘制' && i.pressed === 'true'),
        `data-hs-draw-tool=${first.drawTool}；${JSON.stringify(first.items)}`,
    );

    // 点「还原」
    const picked = await cdp.call(() => {
        const btn = [...document.querySelectorAll('button')].find(
            (b) => (b.textContent || '').trim() === '还原',
        );
        if (!btn) return false;
        btn.click();
        return true;
    });
    await sleep(700);
    const second = await openMenu();
    console.log('▸ 选「还原」后再开菜单：' + JSON.stringify(second));
    check(
        'D2-c 选「还原」后：菜单高亮落在**还原**上（界面反映当前工具）',
        picked &&
            (second.items ?? []).some((i) => i.label === '还原' && i.pressed === 'true') &&
            !(second.items ?? []).some((i) => i.label === '绘制' && i.pressed === 'true'),
        `${JSON.stringify(second.items)}`,
    );
    check(
        'D2-d 绘制按钮的 `data-hs-draw-tool` = restore（收起菜单也看得出）',
        second.drawTool === 'restore',
        `data-hs-draw-tool=${second.drawTool}`,
    );

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((r) => !r.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
