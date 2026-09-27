#!/usr/bin/env node
/**
 * D7 验收：参数行里**气声**那一行的「左侧图标」与「右侧开启胶囊里的图标」应当
 * **只差颜色**（用户口径），可见化判据 = 两者的**不透明度一致**。
 *
 * 背景：左侧图标外层有一条通用规则"非当前参数的行压暗到 0.4"，
 * 而右侧胶囊在开启态画的是实心（1.0）图形 ⇒ 同一个 `BreathAirIcon` 一深一浅，
 * 看着像两款图标。修法是给气声行豁免压暗。
 *
 * 用法：node scripts\_probe-breath-icon.mjs [serial]
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

    // ① 打开参数面板（👁 面板挂在参数工具行上）
    const ready = await cdp.call(async () => {
        const clickText = async (text) => {
            const el = [...document.querySelectorAll('button,[role="menuitem"],div')].find(
                (b) => (b.textContent || '').trim() === text && b.children.length <= 3,
            );
            if (!el) return false;
            el.click();
            return true;
        };
        const waitFor = async (sel, ms) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                if (document.querySelector(sel)) return true;
                await new Promise((r) => setTimeout(r, 200));
            }
            return false;
        };
        if (document.querySelector('.hs-param-rows')) return 'already';
        /* 冷启动后菜单渲染较慢：每轮都把等待拉长一点，最多试 3 轮
           （第一版固定 300ms 就在刚启动时点空了 ⇒ 参数面板 "missing"）。 */
        for (let i = 0; i < 3; i++) {
            await clickText('视图');
            await new Promise((r) => setTimeout(r, 600 + i * 400));
            await clickText('参数面板');
            if (await waitFor('.hs-param-rows', 1500)) return 'opened';
        }
        return 'missing';
    });
    console.log('▸ 参数面板：' + JSON.stringify(ready));

    /* ①b **造前置**：气声行只在算法提供 `breathiness`（world）时才出现；
       当前算法（nsf-hifigan）下 👁 面板里没有这一行（实测只有 音高/张力/音量/声像）。
       切换走的是 v 菜单里那个「算法」下拉 —— 也就是我上一轮改过排版的同一个控件。 */
    const algoArg = process.argv.includes('--algo')
        ? process.argv[process.argv.indexOf('--algo') + 1]
        : '';
    if (algoArg) {
        const switched = await cdp.call(async (algo) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            // 打开 v 菜单（∨ 是开关：先看状态）
            if (document.body.getAttribute('data-hs-param-menu') !== 'open') {
                const v = [...document.querySelectorAll('button')].find(
                    (b) => (b.getAttribute('data-tooltip') || b.ariaLabel || '') === '参数菜单',
                );
                v?.click();
                await wait(600);
            }
            const group = document.querySelector('[data-hs-param-group="algo"]');
            const trigger = group ? group.querySelector('.rt-SelectTrigger, [role="combobox"]') : null;
            if (!trigger) return 'no-trigger';
            trigger.click();
            await wait(600);
            const opt = [...document.querySelectorAll('[role="option"]')].find(
                (o) => (o.textContent || '').trim().toLowerCase() === algo,
            );
            if (!opt) {
                return (
                    'no-option:' +
                    [...document.querySelectorAll('[role="option"]')]
                        .map((o) => (o.textContent || '').trim())
                        .join('|')
                );
            }
            opt.click();
            await wait(900);
            return 'switched';
        }, algoArg);
        console.log(`▸ 切换算法 → ${algoArg}：` + JSON.stringify(switched));
    }

    /* ①c **再造一层前置**：气声行还要求根轨开着「合成」（Compose）——
       用户真机上的工程就是开着的（那份 DOM dump 里能看到"气声: 关闭"胶囊）。
       轨道头上有 aria-label 为「合成」的按钮。 */
    if (process.argv.includes('--compose')) {
        const composed = await cdp.call(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const btn = [...document.querySelectorAll('button')].find(
                (b) => (b.ariaLabel || '') === '合成',
            );
            if (!btn) return 'no-button';
            const pressed = btn.getAttribute('aria-pressed');
            if (pressed === 'true') return 'already-on';
            btn.click();
            await wait(900);
            return 'clicked';
        });
        console.log('▸ 打开轨道「合成」：' + JSON.stringify(composed));
    }

    // ② 打开 👁（参数与覆盖层）面板
    const eye = await cdp.call(() => {
        const btn = [...document.querySelectorAll('button')].find(
            (b) => (b.getAttribute('data-tooltip') || b.ariaLabel || '') === '参数与覆盖层',
        );
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true };
    });
    await sleep(700);
    console.log('▸ 打开 👁 面板：' + JSON.stringify(eye));

    // ③ 量「气声」行左右两枚图标的**计算不透明度**
    //    `--scan-tracks`：逐条选中轨道再量 —— 气声行取决于**当前轨道**的算法/合成状态，
    //    用户真机上有一条轨道是开的（首次 DOM dump 里就有「气声: 关闭」胶囊）。
    const scanTracks = process.argv.includes('--scan-tracks');
    const readRows = () =>
        cdp.call(() => {
            const rows = [...document.querySelectorAll('button[aria-label]')].filter((b) =>
                ['气声', '音高', '张力', '音量', '声像'].includes((b.getAttribute('aria-label') || '').trim()),
            );
            const out = [];
            for (const btn of rows) {
                const label = (btn.getAttribute('aria-label') || '').trim();
                const leftWrap = btn.querySelector('span[aria-hidden="true"]');
                const svg = leftWrap ? leftWrap.querySelector('svg') : null;
                /* 胶囊必须**在同一行内**找：全局找会永远命中第一行那个「气声: 关闭」
                   （第一版就是这么误报的 —— 四行的 pillLabel 全是同一个）。 */
                const rowBox = btn.parentElement;
                const pill = rowBox
                    ? [...rowBox.querySelectorAll('button')].find((b) =>
                          /^气声[:：]/.test(b.getAttribute('aria-label') || ''),
                      )
                    : null;
                const pillSvg = pill ? pill.querySelector('svg') : null;
                const cs = (el) => (el ? getComputedStyle(el) : null);
                out.push({
                    row: label,
                    leftOpacity: leftWrap ? cs(leftWrap).opacity : null,
                    leftColor: svg ? cs(svg).color : null,
                    pillOpacity: pillSvg ? cs(pillSvg.parentElement || pillSvg).opacity : null,
                    pillColor: pillSvg ? cs(pillSvg).color : null,
                    pillLabel: pill ? pill.getAttribute('aria-label') : null,
                });
            }
            return out;
        });
    let measured = await readRows();
    if (scanTracks && !measured.some((m) => m.row === '气声')) {
        const n = await cdp.call(() => document.querySelectorAll('[data-hs-track-row]').length);
        for (let i = 0; i < n; i++) {
            await cdp.call((idx) => {
                const row = document.querySelectorAll('[data-hs-track-row]')[idx];
                if (!row) return false;
                const r = row.getBoundingClientRect();
                row.dispatchEvent(
                    new PointerEvent('pointerdown', {
                        bubbles: true,
                        cancelable: true,
                        button: 0,
                        clientX: r.left + 20,
                        clientY: r.top + r.height / 2,
                    }),
                );
                return true;
            }, i);
            await sleep(900);
            const rows = await readRows();
            console.log(`▸ 轨道 #${i}：` + rows.map((r) => r.row).join('/'));
            if (rows.some((m) => m.row === '气声')) {
                measured = rows;
                console.log(`▸ 命中：轨道 #${i} 有气声行`);
                break;
            }
        }
    }
    console.log('▸ 实测：' + JSON.stringify(measured, null, 1));

    const breath = measured.find((m) => m.row === '气声');
    const others = measured.filter((m) => m.row !== '气声');
    console.log('\n════════ D7 判定 ════════');
    console.log(
        `${breath && Number(breath.leftOpacity) === 1 ? '✅' : '🔴'} 气声行左侧图标不再被压暗：leftOpacity=${breath ? breath.leftOpacity : '(未找到气声行)'}（右侧胶囊图标 opacity=${breath ? breath.pillOpacity : '-'}，颜色 ${breath ? breath.pillColor : '-'} vs 左侧 ${breath ? breath.leftColor : '-'}）`,
    );
    console.log(
        `ℹ️ 其它行仍按"非当前参数压暗"：${others.map((o) => `${o.row}=${o.leftOpacity}`).join(' ')}`,
    );
    cdp.close();
};

await main();
