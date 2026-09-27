#!/usr/bin/env node
/**
 * 「外观设置」在移动端的验收探针（2026-09-22）。
 *
 * 背景：桌面版外观设置是 Tauri 独立窗口（`WebviewWindow` + appearance.html），
 * Android 没有多窗口能力 ⇒ 菜单项此前是 `window.alert("暂不可用")`（点了没反应）。
 * 现在改为应用内近全屏面板（`AppearanceSettingsDialog` 的 embedded 分支 + 同一份
 * `AppearanceWindow`），本脚本验证整条链路：
 *
 *   ① 顶栏「视图」→「外观设置…」能把面板打开（且是 embedded 模式）
 *   ② 面板铺满视口、两个 Tab 与底部按钮都在视口内
 *   ③ 切到「字体」Tab 内容确实换了
 *   ④ 实时预览：面板里选「浅色」，documentElement 的 data-theme 当场变化
 *   ⑤ 「关闭」→ 面板消失且主题回滚到打开前的值
 *   ⑥ 「应用」→ 面板消失且 localStorage 落盘
 *
 * 用法：node scripts/_probe-appearance.mjs [--serial emulator-5554] [--skip-apply]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADB = process.env.ADB ?? 'D:/Android/Sdk/platform-tools/adb.exe';

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, skipApply: false, keepOpen: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--skip-apply') o.skipApply = true;
        else if (a === '--keep-open') o.keepOpen = true;
    }
    return o;
}

/* ═══════════════ 页面内函数（必须自包含，会被序列化后注入） ═══════════════ */

/** 按文本/aria-label 找可见元素，返回其中心点 */
function inPageFind(arg) {
    const { texts, scope } = arg;
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return null;
    const all = [
        ...root.querySelectorAll('button, [role="menuitem"], [role="tab"], [role="radio"], a'),
    ];
    for (const want of texts) {
        for (const el of all) {
            const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
            if (label !== want) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
            return {
                text: want,
                x: Math.round(cx),
                y: Math.round(cy),
                w: Math.round(r.width),
                h: Math.round(r.height),
                tag: el.tagName,
                role: el.getAttribute('role'),
            };
        }
    }
    return null;
}

/** 只看**面板内部**的触摸目标（面板是覆盖层，全页审计会把底下的主界面也算进来） */
function inPageTouchTargets() {
    const root = document.querySelector('[data-hs-appearance-root]');
    if (!root) return null;
    const sel = 'button, [role="radio"], [role="tab"], input, select, a';
    const all = [...root.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
    });
    const small = [];
    for (const el of all) {
        const r = el.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w >= 40 && h >= 40) continue;
        small.push({
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16),
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 36),
            /** 父元素类名：色块这类"透明 input 覆盖在方块上"的结构，光看自身看不出来 */
            parent: el.parentElement ? String(el.parentElement.className || '').slice(0, 34) : '',
            type: el.getAttribute('type') || '',
            w,
            h,
        });
    }
    // 同类控件聚合（面板里色块动辄几十个，逐条列会刷屏）
    const groups = new Map();
    for (const s of small) {
        const key = `${s.w}×${s.h}  ${s.tag}[type=${s.type}].${s.cls}  ←父 .${s.parent}  「${s.label}」`;
        groups.set(key, (groups.get(key) || 0) + 1);
    }
    // 内容区是否有横向溢出（手机窄屏最容易踩）
    const scroller = root.querySelector('.overflow-y-auto');
    return {
        total: all.length,
        smallCount: small.length,
        groups: [...groups.entries()].map(([k, n]) => `${n} × ${k}`),
        overflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
    };
}

/** 面板 + 主题状态快照 */
function inPageSnapshot() {
    const rect = (e) => {
        const r = e.getBoundingClientRect();
        return {
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
        };
    };
    const cs = getComputedStyle(document.documentElement);
    const root = document.querySelector('[data-hs-appearance-root]');
    const dialog = document.querySelector('[role="dialog"]');
    const out = {
        viewport: { w: innerWidth, h: innerHeight },
        dialog: dialog ? rect(dialog) : null,
        panel: null,
        theme: document.documentElement.dataset.theme ?? null,
        accent: cs.getPropertyValue('--accent-9').trim(),
        qtSample: cs.getPropertyValue('--qt-playhead').trim(),
        tabLabels: [],
        buttonLabels: [],
        fontRows: 0,
        colorRows: 0,
        storage: null,
    };
    try {
        const raw = localStorage.getItem('hifishifter.appearance');
        out.storage = raw ? raw.slice(0, 160) : null;
    } catch {
        /* ignore */
    }
    if (!root) return out;

    const panelRect = rect(root);
    out.panel = { mode: root.getAttribute('data-hs-appearance-root'), ...panelRect };
    /** 面板与视口还差多少（全屏面板应为 0；>2 说明被 Dialog 的定位/动画缩了） */
    out.panelGap = { w: innerWidth - panelRect.w, h: innerHeight - panelRect.h };
    out.panelInView =
        panelRect.x >= -1 &&
        panelRect.y >= -1 &&
        panelRect.x + panelRect.w <= innerWidth + 1 &&
        panelRect.y + panelRect.h <= innerHeight + 1;

    const btns = [...root.querySelectorAll('button')];
    out.buttonLabels = [...new Set(btns.map((e) => (e.textContent || '').trim()).filter(Boolean))].slice(
        0,
        30,
    );
    out.tabLabels = btns
        .map((e) => (e.textContent || '').trim())
        .filter((s) => ['主题', '字体'].includes(s));
    out.fontRows = [...root.querySelectorAll('*')].filter(
        (e) => (e.textContent || '').trim() === '系统字体',
    ).length;
    out.colorRows = root.querySelectorAll('input[type="color"], input[type="text"]').length;
    return out;
}

/* ═══════════════ 主流程 ═══════════════ */

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`${ADB} -s ${o.serial} shell pidof com.arounder.hifishifter`)
        .toString()
        .trim()
        .replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑：先 `adb shell am start -n com.arounder.hifishifter/.MainActivity`');
    console.log(`▸ 进程 pid=${pid}`);
    execSync(`${ADB} -s ${o.serial} forward tcp:${o.port} localabstract:webview_devtools_remote_${pid}`);

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const tap = async (pt) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x: pt.x, y: pt.y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(90);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(700);
    };
    const find = (texts, scope = null) => cdp.call(inPageFind, { texts, scope });
    const snap = () => cdp.call(inPageSnapshot);
    const fail = [];

    // 幂等：上一轮若用 --keep-open 收尾，面板还开着，会把「视图」菜单挡住 ⇒ 先从干净状态开始
    const pre = await snap();
    if (pre.panel) {
        console.log('▸ 检测到面板已打开（上轮残留），先关掉');
        const c = await find(['关闭'], '[data-hs-appearance-root]');
        if (c) {
            await tap(c);
            await sleep(800);
        }
    }

    const s0 = await snap();
    console.log(`\n▸ 视口 ${s0.viewport.w}×${s0.viewport.h} CSS`);
    console.log(`▸ 打开前：theme=${s0.theme}  --qt-playhead=${s0.qtSample || '(空)'}`);

    /* ── ① 打开面板 ── */
    console.log('\n① 顶栏「视图」→「外观设置…」');
    let v = await find(['视图', '视图 ›']);
    if (!v) {
        // 顶栏菜单按钮就是 header 里的 button，文本可能带后缀
        v = await cdp.call(() => {
            const b = [...document.querySelectorAll('header button')].find((e) =>
                (e.textContent || '').trim().startsWith('视图'),
            );
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { text: '视图', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        });
    }
    if (!v) {
        fail.push('顶栏找不到「视图」按钮');
        console.log('   ✗ 顶栏找不到「视图」按钮');
    } else {
        console.log(`   · 点「视图」(${v.x},${v.y}) ${v.w}×${v.h}`);
        await tap(v);
        const item = await find(['外观设置...', '外观设置…', '外观设置']);
        if (!item) {
            const labels = await cdp.call(() =>
                [...document.querySelectorAll('[role="menuitem"]')].map((e) => (e.textContent || '').trim()),
            );
            fail.push('视图菜单里没有「外观设置」项');
            console.log(`   ✗ 菜单项里没有外观设置：${JSON.stringify(labels)}`);
        } else {
            console.log(`   · 点「${item.text}」(${item.x},${item.y}) role=${item.role}`);
            await tap(item);
        }
    }

    const s1 = await snap();
    if (!s1.panel) {
        fail.push('面板没打开（找不到 [data-hs-appearance-root]）');
        console.log('   ✗ 面板没打开（找不到 [data-hs-appearance-root]）');
    } else {
        console.log(`   ✅ 面板已打开 mode=${s1.panel.mode} rect=${s1.panel.x},${s1.panel.y} ${s1.panel.w}×${s1.panel.h}`);
    }

    /* ── ② 排版 ── */
    console.log('\n② 面板排版');
    if (s1.panel) {
        console.log(`   · 在视口内：${s1.panelInView ? '✅' : '❌'}（${s1.panel.w}×${s1.panel.h} vs ${s1.viewport.w}×${s1.viewport.h}）`);
        // 2026-09-22 用户口径：面板**不再贴满屏**，四周要留一点空隙（屏幕边界 / 外框 / 内框
        // 各留一点）。所以"差 18px"是**设计值**（每边 8px inset + 1px 描边），不是"没铺满"。
        // 判据改为：留边落在 12~24px 之间算正常；超出视口、或留边过大/过小才算失败。
        const gapW = s1.panelGap.w;
        const gapH = s1.panelGap.h;
        const gapOk = gapW >= 12 && gapW <= 24 && gapH >= 12 && gapH <= 24;
        console.log(
            `   · 与视口的差：${gapW}×${gapH}px ${gapOk ? '✅ 留边正常（设计值 ≈18px）' : '❌ 异常（应 12~24px）'}`,
        );
        if (!s1.panelInView) fail.push('面板超出视口');
        if (!gapOk) {
            fail.push(`面板留边异常（差 ${gapW}×${gapH}px，应 12~24px）`);
        }
        console.log(`   · Tab：${JSON.stringify(s1.tabLabels)}`);
        console.log(`   · 按钮：${JSON.stringify(s1.buttonLabels)}`);
        const need = ['关闭', '应用'];
        const miss = need.filter((n) => !s1.buttonLabels.includes(n));
        if (miss.length) {
            fail.push(`面板缺少按钮 ${JSON.stringify(miss)}`);
            console.log(`   ✗ 缺少 ${JSON.stringify(miss)}`);
        } else {
            console.log('   ✅ 关闭 / 应用 都在');
        }
        console.log(`   · 颜色输入框 ${s1.colorRows} 个`);

        const tt = await cdp.call(inPageTouchTargets);
        if (tt) {
            console.log(
                `   · 面板内可点元素 ${tt.total} 个，触摸目标 <40 的 ${tt.smallCount} 个；内容区横向溢出 ${tt.overflowX}px`,
            );
            for (const g of tt.groups) {
                console.log(`       - ${g}`);
            }
            // 只允许两类偏小：调色板色块（视觉 32 + 命中区 40）与原生取色器（父已撑到 40 宽）
            const unexpected = tt.groups.filter(
                (g) => !/w-6 h-6|input\[type=color\]/.test(g),
            );
            if (unexpected.length) {
                fail.push(`面板内仍有非预期的偏小触摸目标 ${unexpected.length} 类`);
                console.log(`   ✗ 非预期偏小组：${unexpected.length} 类`);
            }
        }
    }

    if (o.keepOpen) {
        console.log('\n▸ --keep-open：面板保持打开（供 layout-audit 接着审计）');
        console.log(fail.length ? `⚠️ 已有 ${fail.length} 项失败：${fail.join('；')}` : '✅ 打开 + 排版两项通过');
        cdp.close();
        if (fail.length) process.exitCode = 1;
        return;
    }

    /* ── ③ Tab 切换 ── */
    console.log('\n③ 切到「字体」Tab');
    const fontTab = await find(['字体'], '[data-hs-appearance-root]');
    if (!fontTab) {
        fail.push('找不到「字体」Tab');
        console.log('   ✗ 找不到「字体」Tab');
    } else {
        await tap(fontTab);
        const s2 = await snap();
        const changed = s2.buttonLabels.join('|') !== s1.buttonLabels.join('|');
        console.log(`   · 切换后按钮集变化：${changed ? '✅' : '❌'}`);
        console.log(`   · 字体 Tab 按钮：${JSON.stringify(s2.buttonLabels.slice(0, 14))}`);
        if (!changed) fail.push('切 Tab 后内容没变');
        // 切回主题
        const themeTab = await find(['主题'], '[data-hs-appearance-root]');
        if (themeTab) await tap(themeTab);
    }

    /* ── ④ 实时预览 ── */
    console.log('\n④ 实时预览（面板里选「浅色」）');
    const before = await snap();
    const lightBtn = await find(['浅色'], '[data-hs-appearance-root]');
    if (!lightBtn) {
        console.log('   ⚠ 找不到「浅色」按钮（可能当前已是浅色）');
    } else {
        await tap(lightBtn);
    }
    const after = await snap();
    const themeChanged = before.theme !== after.theme;
    const accentChanged = before.accent !== after.accent;
    console.log(`   · data-theme ${before.theme} → ${after.theme}  ${themeChanged ? '✅ 已变化' : '（未变）'}`);
    console.log(`   · --accent-9 ${before.accent} → ${after.accent}  ${accentChanged ? '✅ 已变化' : '（未变）'}`);
    if (!themeChanged && !accentChanged) fail.push('预览没有实时生效');

    /* ── ⑤ 关闭 → 回滚 ── */
    console.log('\n⑤ 点「关闭」→ 面板消失 + 主题回滚');
    const closeBtn = await find(['关闭'], '[data-hs-appearance-root]');
    if (!closeBtn) {
        fail.push('找不到「关闭」按钮');
        console.log('   ✗ 找不到「关闭」按钮');
    } else {
        await tap(closeBtn);
        // Radix 的退场是动画，元素会晚一拍才从 DOM 摘掉 —— 逐拍观察，顺便记录
        // `data-state`（若长期停在 `closed` 说明动画结束事件没送达，元素会一直挂着）。
        for (let i = 0; i < 6; i++) {
            const s = await snap();
            const st = await cdp.call(() => {
                const d = document.querySelector('[role="dialog"]');
                return d ? d.getAttribute('data-state') : null;
            });
            console.log(
                `   · +${800 + i * 400}ms 面板=${s.panel ? `还在 ${s.panel.w}×${s.panel.h}` : '已消失'} data-state=${st}`,
            );
            if (!s.panel) break;
            await sleep(400);
        }
    }
    const s3 = await snap();
    console.log(`   · 面板：${s3.panel ? '❌ 还在' : '✅ 已关闭'}；theme=${s3.theme}（打开前 ${s0.theme}）`);
    if (s3.panel) fail.push('点「关闭」后面板没消失');
    if (s3.theme !== s0.theme) {
        fail.push(`关闭后主题没回滚（${s0.theme} → ${s3.theme}）`);
        console.log('   ✗ 主题没回滚');
    } else {
        console.log('   ✅ 已回滚到打开前的主题');
    }

    /* ── ⑥ 应用 → 持久化 ── */
    if (!o.skipApply) {
        console.log('\n⑥ 再打开 → 换个模式 → 点「应用」→ 落盘');
        const v2 = await cdp.call(() => {
            const b = [...document.querySelectorAll('header button')].find((e) =>
                (e.textContent || '').trim().startsWith('视图'),
            );
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { text: '视图', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        });
        if (v2) {
            await tap(v2);
            const item2 = await find(['外观设置...', '外观设置…', '外观设置']);
            if (item2) await tap(item2);
            const other = await find(['深色', '浅色'], '[data-hs-appearance-root]');
            if (other) {
                console.log(`   · 选「${other.text}」`);
                await tap(other);
            }
            const applyBtn = await find(['应用'], '[data-hs-appearance-root]');
            if (!applyBtn) {
                fail.push('找不到「应用」按钮');
                console.log('   ✗ 找不到「应用」按钮');
            } else {
                await tap(applyBtn);
                const s4 = await snap();
                console.log(`   · 面板：${s4.panel ? '❌ 还在' : '✅ 已关闭'}；theme=${s4.theme}`);
                console.log(`   · localStorage: ${s4.storage ?? '(空)'}`);
                if (s4.panel) fail.push('点「应用」后面板没消失');
                if (!s4.storage) fail.push('点「应用」后 localStorage 没落盘');
            }
        } else {
            console.log('   ⚠ 顶栏「视图」没找到，跳过 ⑥');
        }
    }

    console.log('\n════════════════ 结论 ════════════════');
    if (fail.length) {
        console.log(`❌ ${fail.length} 项未通过：`);
        for (const f of fail) console.log(`   · ${f}`);
        process.exitCode = 1;
    } else {
        console.log('✅ 全部通过');
    }
    cdp.close();
}

main().catch((e) => {
    console.error(`❌ 探针失败：${e.message}`);
    process.exitCode = 2;
});
