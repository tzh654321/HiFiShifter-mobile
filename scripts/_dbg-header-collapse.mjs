#!/usr/bin/env node
/**
 * C1/C2 诊断 + 验收：轨道头收起（左划隐藏）后的布局真值。
 *
 * 量三件事：
 *   ① 时间/拍数读数（形如 `9.2.479 / 0:16.739`）在哪、收起后是否还在；
 *   ② 轨道头列外壳宽度 / 时间线容器宽度（收起后轨道区**应变宽**）；
 *   ③ 电平条（`[data-hs-meter]`）与颜色圆点是否仍**完整可见**（不被裁）。
 *
 * 用法：node scripts\_dbg-header-collapse.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? 'emulator-5554';

/** 页面内：一次量齐所有真值。 */
function measure() {
    const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            left: Math.round(r.left),
            top: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
        };
    };
    const listPanel = document.querySelector('[data-track-list-panel]');
    const listShell = listPanel ? listPanel.parentElement : null;
    /* 祖先链（含 inline style 与计算宽度）：收起规则要落到**真正占宽的那一层**上，
       而"真正占宽的那层"未必是 `[data-track-list-panel]` 的直接父节点。 */
    const chain = [];
    {
        let cur = listPanel;
        for (let i = 0; i < 5 && cur; i++) {
            const r = cur.getBoundingClientRect();
            chain.push({
                tag: cur.tagName,
                cls: String(cur.className).slice(0, 48),
                w: Math.round(r.width),
                left: Math.round(r.left),
                inline: String(cur.getAttribute('style') || '').slice(0, 90),
            });
            cur = cur.parentElement;
        }
    }
    const scroller = document.querySelector('[data-timeline-scroller="true"]');
    // 时间/拍数读数：形如 "9.2.479 / 0:16.739"
    const readoutCandidates = [...document.querySelectorAll('div,span')]
        .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.top > 140 || r.left > 220 || r.width === 0) return false;
            const t = (el.textContent || '').trim();
            return t.length > 0 && t.length < 40 && /\d/.test(t) && /[:\/.]/.test(t);
        })
        .map((el) => ({
            tag: el.tagName,
            text: (el.textContent || '').trim(),
            cls: String(el.className).slice(0, 40),
            kids: el.children.length,
            rect: `${Math.round(el.getBoundingClientRect().left)},${Math.round(el.getBoundingClientRect().top)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
        }))
        .slice(0, 8);
    const readout = (() => {
        const bar = document.querySelector('[data-hs-tracklist-head-bar]');
        if (!bar) return null;
        const cs = getComputedStyle(bar);
        const time = [...bar.querySelectorAll('div,span')].find((el) =>
            /^\d+\.\d+\.\d+\s*\/\s*\d+:\d+/.test((el.textContent || '').trim()),
        );
        const tr = time ? time.getBoundingClientRect() : null;
        return {
            /** 时间/拍数读数所在的整行是否被隐藏（C2 的判据）。 */
            barDisplay: cs.display,
            barHidden: cs.display === 'none',
            text: time ? (time.textContent || '').trim().slice(0, 24) : null,
            /** 读数自身是否还落在轨道头可视区（x < 26）内 —— 隐藏失效时它会露出来。 */
            textLeft: tr ? Math.round(tr.left) : null,
            textRight: tr ? Math.round(tr.right) : null,
        };
    })();
    const meters = [...document.querySelectorAll('[data-hs-meter]')].map((el) => {
        const r = el.getBoundingClientRect();
        const host = el.closest('[data-track-list-panel]');
        const hr = host ? host.getBoundingClientRect() : null;
        return {
            rect: { left: Math.round(r.left), w: Math.round(r.width) },
            /** 是否被宿主窄条裁掉（右缘超出宿主可视宽 + 2px 容差）。 */
            clippedByHost: hr ? r.right > hr.right + 2 || r.left < hr.left - 2 : null,
        };
    });
    return {
        collapsed: document.body.getAttribute('data-hs-header-collapsed'),
        hasSelector:
            typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('selector(:has(*))') : null,
        chain,
        listShell: rect(listShell),
        listPanel: rect(listPanel),
        scroller: rect(scroller),
        readout,
        readoutCandidates,
        shellMatchesCollapseRule: listShell
            ? listShell.matches('body[data-hs-header-collapsed="1"] div:has(> [data-track-list-panel])')
            : null,
        shellComputed: listShell
            ? {
                  width: getComputedStyle(listShell).width,
                  flex: getComputedStyle(listShell).flex,
              }
            : null,
        closeBtn: rect(document.querySelector('.hs-panel-close')),
        meters,
        meterCount: meters.length,
    };
}

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

    // 保证展开态起步
    await cdp.call(() => document.body.removeAttribute("data-hs-header-collapsed"));
    await sleep(400);
    const expanded = await cdp.call(measure);
    console.log('▸ 展开态：' + JSON.stringify(expanded, null, 1));

    // 在轨道头（左侧列）上左划 → 收起。划动轴 y 可用 `--y` 指定（默认取首行中心）：
    // ④b 在探针里用的是固定的 y=300，这里要把"y 不同是否结果不同"一次问清。
    const yArg = process.argv.includes('--y') ? Number(process.argv[process.argv.indexOf('--y') + 1]) : null;
    const geo = await cdp.call(() => {
        const el = document.querySelectorAll('[data-hs-track-row]')[0];
        const r = el.getBoundingClientRect();
        return { y: Math.round(r.top + r.height * 0.5) };
    });
    if (yArg !== null) geo.y = yArg;
    console.log(`▸ 划动轴 y=${geo.y}`);
    await touch('touchStart', [{ id: 0, x: 120, y: geo.y }]);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ id: 0, x: 120 - (95 * i) / 4, y: geo.y }]);
        await sleep(45);
    }
    await touch('touchEnd', []);
    await sleep(700);
    const collapsed = await cdp.call(measure);
    console.log('▸ 收起态：' + JSON.stringify(collapsed, null, 1));

    // 收起后：在**26px 窄条内**右划 → 应重新展开（规格：右划再展开）
    const hitAt12 = await cdp.call(
        (y) => {
            const el = document.elementFromPoint(12, y);
            if (!el) return null;
            const chain = [];
            let cur = el;
            for (let i = 0; i < 4 && cur; i++) {
                chain.push(`${cur.tagName}.${String(cur.className).slice(0, 26)}`);
                cur = cur.parentElement;
            }
            const cs = getComputedStyle(el);
            return { chain, pe: cs.pointerEvents };
        },
        geo.y,
    );
    console.log('\n▸ 收起态 (12,' + geo.y + ') 上是：' + JSON.stringify(hitAt12));
    await touch('touchStart', [{ id: 0, x: 12, y: geo.y }]);
    for (let i = 1; i <= 4; i++) {
        await touch('touchMove', [{ id: 0, x: 12 + (98 * i) / 4, y: geo.y }]);
        await sleep(45);
    }
    await touch('touchEnd', []);
    await sleep(700);
    const reExpanded = await cdp.call(measure);
    console.log(
        `\n${reExpanded.collapsed === null ? '✅' : '🔴'} ④b 窄条内右划 → 展开：collapsed=${reExpanded.collapsed}（划动轴 y=${geo.y}，起点 x=12）`,
    );

    const scrollerGrew = (collapsed.scroller?.w ?? 0) > (expanded.scroller?.w ?? 0) + 10;
    const shellNarrow = (collapsed.listShell?.w ?? 999) <= 30;
    const metersVisible = collapsed.meters.length > 0 && collapsed.meters.every((m) => m.clippedByHost === false);
    const readoutHidden = collapsed.readout !== null && collapsed.readout.barHidden === true;
    console.log('\n════════ 判定 ════════');
    console.log(`${shellNarrow ? '✅' : '🔴'} C1-a 轨道头外壳收窄到窄条：${expanded.listShell?.w} → ${collapsed.listShell?.w}`);
    console.log(`${scrollerGrew ? '✅' : '🔴'} C1-b 时间线容器跟着变宽：${expanded.scroller?.w} → ${collapsed.scroller?.w}`);
    console.log(
        `${metersVisible ? '✅' : '🔴'} C1-c 电平条完整可见：${JSON.stringify(collapsed.meters)}`,
    );
    console.log(
        `${readoutHidden ? '✅' : '🔴'} C2 收起后时间/拍数整行隐藏、只留 ✕：展开态=${JSON.stringify(expanded.readout)}；收起态=${JSON.stringify(collapsed.readout)}；✕=${JSON.stringify(collapsed.closeBtn)}`,
    );
    cdp.close();
};

await main();
