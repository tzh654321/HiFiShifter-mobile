#!/usr/bin/env node
/**
 * E13 验收：**收起轨道头后，从"无轨道处"右滑能重新展开**。
 *
 * 用户口径：「轨道头缩小后从无轨道处右滑无法展开轨道头，需修」。
 * 病根：左划收起 / 右划展开只挂在滚动容器 `[data-track-list-panel]` 上，
 *       而收起后那是 26px 窄条，手指常落在**头行**（滚动容器的兄弟）或外壳空白处
 *       ⇒ 事件到不了容器。
 * 修法：同一套判定再挂到**外壳**与**文档级兜底**（收起态 + 起点 x≤40px）。
 *
 * 判据（真实触摸）：
 *   ① 置位收起态后，在**头行上**右划 ⇒ 属性被移除（展开）；
 *   ② 再置位，在**列表底部空白处**（无轨道处）右划 ⇒ 属性被移除（展开）；
 *   ③ 反例：**左划**应仍是收起（语义不倒）。
 *
 * 用法：node scripts\_probe-e13-expand-from-blank.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';

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

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    const swipe = async (x0, y, dx) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: x0, y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        for (let i = 1; i <= 10; i++) {
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ id: 0, x: Math.round(x0 + (dx * i) / 10), y, radiusX: 6, radiusY: 6, force: 1 }],
            });
            await sleep(22);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(500);
    };

    const collapsedNow = () =>
        cdp.call(() => document.body.getAttribute('data-hs-header-collapsed'));

    // 几何：头行中心、列表底部空白（无轨道处）
    const geo = await cdp.call(async () => {
        const head = document.querySelector('[data-hs-tracklist-head-bar]');
        const list = document.querySelector('[data-track-list-panel]');
        const rows = [...document.querySelectorAll('[data-hs-track-row]')].map((r) => r.getBoundingClientRect());
        const hr = head?.getBoundingClientRect();
        const lr = list?.getBoundingClientRect();
        const lastRowBottom = rows.length ? Math.max(...rows.map((r) => r.bottom)) : (lr?.top ?? 0);
        // 「无轨道处」= 最后一行下方、列表底边上方 30px 的空白
        const blankY = lr ? Math.round(Math.min(lr.bottom - 30, Math.max(lastRowBottom + 30, lr.top + 10))) : null;
        return {
            colRight: lr ? Math.round(lr.right) : null,
            headY: hr ? Math.round(hr.top + hr.height / 2) : null,
            blankY,
            listBottom: lr ? Math.round(lr.bottom) : null,
            rowCount: rows.length,
        };
    });
    console.log('▸ 几何：' + JSON.stringify(geo));

    const setCollapsed = (v) =>
        cdp.call((val) => {
            if (val) document.body.setAttribute('data-hs-header-collapsed', '1');
            else document.body.removeAttribute('data-hs-header-collapsed');
            return document.body.getAttribute('data-hs-header-collapsed');
        }, v);

    // ① 头行上右划 ⇒ 展开
    await setCollapsed(true);
    await sleep(300);
    await swipe(12, geo.headY ?? 69, +90);
    const after1 = await collapsedNow();
    check(
        'E13-a 收起态在**头行**上右滑 ⇒ 展开（属性被移除）',
        after1 === null,
        `右滑后 data-hs-header-collapsed=${JSON.stringify(after1)}`,
    );

    // ② 无轨道处（列表底部空白）右划 ⇒ 展开
    await setCollapsed(true);
    await sleep(300);
    if (geo.blankY !== null) await swipe(12, geo.blankY, +90);
    const after2 = await collapsedNow();
    check(
        'E13-b 收起态在**无轨道处**右滑 ⇒ 展开（本次修复的核心）',
        after2 === null && geo.blankY !== null,
        `起点 y=${geo.blankY}（列表底 ${geo.listBottom}，共 ${geo.rowCount} 行）⇒ 属性=${JSON.stringify(after2)}`,
    );

    // ③ 反例：展开态左划 ⇒ 仍应收起（头行、轨道行两个起点都要成立）
    await setCollapsed(false);
    await sleep(300);
    await swipe(Math.max(12, (geo.colRight ?? 180) - 24), geo.headY ?? 69, -90);
    const after3 = await collapsedNow();
    check(
        'E13-c 反例：展开态在**头行**左划 ⇒ 收起（语义不倒）',
        after3 === '1',
        `左滑后 data-hs-header-collapsed=${JSON.stringify(after3)}`,
    );
    await setCollapsed(false);
    await sleep(300);
    await swipe(Math.max(12, (geo.colRight ?? 180) - 24), geo.blankY ?? 203, -90);
    const after4 = await collapsedNow();
    check(
        'E13-d 反例：展开态在**轨道行区域**左划 ⇒ 收起',
        after4 === '1',
        `左滑后 data-hs-header-collapsed=${JSON.stringify(after4)}`,
    );

    // 收尾：恢复展开态
    await setCollapsed(false);

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
