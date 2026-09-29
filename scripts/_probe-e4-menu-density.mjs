#!/usr/bin/env node
/**
 * E4 验收：**^ 型菜单（底栏向上弹出的浮层）一行能放几个按钮**。
 *
 * 用户口径：「使当前手机上一行能显示**四个**按钮、共三行，更大的屏幕下可以让一行显示更多按钮」。
 * 改前：`gridTemplateColumns: repeat(3, 1fr)` —— 写死 3 列。
 * 改后：`repeat(auto-fit, minmax(80px, 1fr))` —— 按可用宽度自适应。
 *
 * 判据：
 *   ① 手机宽度下**每行 4 个**（用真实布局量：同一 top 值的按钮个数）；
 *   ② 把容器视口放宽（模拟大屏）后**每行更多**（> 4）；
 *   ③ 按钮没有被压到不可点（每个按钮宽 ≥ 60px）。
 *
 * 用法：node scripts\_probe-e4-menu-density.mjs [serial]
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

    const results = [];
    const check = (name, ok, detail) => {
        results.push({ name, ok });
        console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
    };

    /* 打开 ^ 浮层：底栏里带 aria-expanded 的按钮（折叠/眼睛/其他面板开关）。
       逐个点，直到页面上出现「绝对定位 + bottom:100% + display:grid」的浮层。 */
    const opened = await cdp.call(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const isPanel = (el) => {
            if (!el) return false;
            const cs = getComputedStyle(el);
            return cs.display === 'grid' && cs.position === 'absolute' && el.querySelectorAll('button').length >= 6;
        };
        const findPanel = () => [...document.querySelectorAll('div')].find(isPanel) ?? null;
        if (findPanel()) return { already: true };
        const triggers = [...document.querySelectorAll('button[aria-expanded]')];
        for (const trg of triggers) {
            trg.click();
            await wait(700);
            const p = findPanel();
            if (p) return { openedBy: (trg.getAttribute('aria-label') || trg.textContent || '').trim().slice(0, 14) };
            // 收起这次没用的
            if (trg.getAttribute('aria-expanded') === 'true') trg.click();
            await wait(300);
        }
        return { openedBy: null, triggers: triggers.length };
    });
    console.log('▸ 打开 ^ 浮层：' + JSON.stringify(opened));
    if (!opened.openedBy && !opened.already) {
        console.log('🔴 没能打开 ^ 浮层（找不到含 ≥6 个按钮的 grid 浮层）；E4 无法验证');
        cdp.close();
        return;
    }

    /** 量：每行按钮数（按 top 分组）、按钮最小宽度、列模板。 */
    const measure = () =>
        cdp.call(() => {
            const panel = [...document.querySelectorAll('div')].find((el) => {
                const cs = getComputedStyle(el);
                return cs.display === 'grid' && cs.position === 'absolute' && el.querySelectorAll('button').length >= 6;
            });
            if (!panel) return null;
            const btns = [...panel.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
            const byRow = new Map();
            for (const r of btns) {
                const key = Math.round(r.top);
                byRow.set(key, (byRow.get(key) ?? 0) + 1);
            }
            const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
            return {
                total: btns.length,
                rows,
                maxPerRow: Math.max(...rows),
                minBtnWidth: Math.round(Math.min(...btns.map((r) => r.width))),
                template: getComputedStyle(panel).gridTemplateColumns,
                panelWidth: Math.round(panel.getBoundingClientRect().width),
            };
        });

    const phone = await measure();
    console.log('▸ 手机宽度下：' + JSON.stringify(phone));
    check(
        'E4-a 手机上一行 **4 个**按钮',
        phone !== null && phone.maxPerRow === 4,
        `每行分布=${JSON.stringify(phone?.rows)}（共 ${phone?.total} 个，面板宽 ${phone?.panelWidth}px）`,
    );
    check(
        'E4-b 按钮没有被压得过窄（≥60px）',
        phone !== null && phone.minBtnWidth >= 60,
        `最窄按钮 ${phone?.minBtnWidth}px；列模板=${phone?.template}`,
    );

    // 模拟大屏：放宽视口后应一行更多
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await sleep(1200);
    const wide = await measure();
    console.log('▸ 900px 视口下：' + JSON.stringify(wide));
    check(
        'E4-c 更宽的屏幕一行显示**更多**（> 4）',
        wide !== null && wide.maxPerRow > 4,
        `每行分布=${JSON.stringify(wide?.rows)}（面板宽 ${wide?.panelWidth}px）`,
    );
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => null);

    console.log('\n════════ 汇总 ════════');
    const fails = results.filter((x) => !x.ok);
    console.log(`通过 ${results.length - fails.length} / ${results.length}`);
    if (fails.length) console.log('未通过：' + fails.map((f) => f.name).join(' · '));
    cdp.close();
};

await main();
