#!/usr/bin/env node
/**
 * 移动端外壳 UI 验收（2026-09-21 用户口径第 18 条）。
 *
 * 一次跑完「看得到 + 点得到」两部分：
 *   看得到 —— 每个控件都在视口内（rect 不为 0、不溢出右/下边界）
 *   点得到 —— 真的 dispatchTouchEvent 点下去，读**状态是否变化**（aria-pressed /
 *             redux 镜像 / 面板出现与消失）
 *
 * 为什么要专门写：`_eval.mjs` 的表达式从 PowerShell 传参时**双引号会被吞掉**
 * （`querySelectorAll(button)` ⇒ `button is not defined`）。把断言固化在脚本里最稳。
 *
 * 用法：node scripts/_probe-shell-ui.mjs --serial emulator-5554 [--tab params]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, tab: 'params' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--tab') o.tab = argv[++i];
    }
    return o;
}

/** 收集外壳控件快照（自包含：CDP 只序列化这一个函数）。 */
function inPageSnapshot() {
    const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const visible = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const btn = (e) => ({
        label: e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 12),
        pressed: e.getAttribute('aria-pressed'),
        ...rect(e),
    });
    const pick = (labels) =>
        [...document.querySelectorAll('button')]
            .filter((e) => labels.includes(e.getAttribute('aria-label')) && visible(e))
            .map(btn);
    const all = [...document.querySelectorAll('button')].filter(visible);

    const outOfView = all
        .map((e) => ({ ...btn(e), over: Math.round(e.getBoundingClientRect().right - window.innerWidth) }))
        .filter((o) => o.over > 1 || o.x < 0);

    return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        topbar: [...document.querySelectorAll('header button')]
            .filter(visible)
            .map((e) => ({ t: (e.textContent || '').trim(), expanded: e.getAttribute('aria-expanded'), ...rect(e) })),
        toolRow: pick(['选择', '绘制', '参数与覆盖层', '参数菜单']),
        bottomBar: pick(['更多开关', '撤销', '重做', '停止', '播放', '录制']),
        tabs: [...document.querySelectorAll('button')]
            .filter((e) => ['轨道', '参数', '文件', '笔记'].includes((e.textContent || '').trim()) && visible(e))
            .map((e) => ({ t: (e.textContent || '').trim(), ...rect(e) })),
        menusOpen: [...document.querySelectorAll('[role=menu]')].map((m) => ({
            a: m.getAttribute('aria-label'),
            n: m.querySelectorAll('button').length,
            ...rect(m),
        })),
        paramUi: window.__hsParamUiState
            ? { editParam: window.__hsParamUiState.editParam, params: (window.__hsParamUiState.params || []).map((p) => p.id) }
            : null,
        outOfView,
    };
}

function inPageToolMode() {
    const b = [...document.querySelectorAll('[aria-label="参数工具行"] button')];
    return b.map((x) => ({ a: x.getAttribute('aria-label'), pressed: x.getAttribute('aria-pressed') }));
}

async function main() {
    const o = parseArgs(process.argv);
    const pid = execSync(`adb -s ${o.serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用没在跑');
    execSync(`adb -s ${o.serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();

    const cdp = await Cdp.attach({ host: '127.0.0.1', port: o.port });
    await cdp.send('Runtime.enable');
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* ignore */
    }

    const center = (r) => [r.x + Math.round(r.w / 2), r.y + Math.round(r.h / 2)];
    const tap = async ([x, y]) => {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
        });
        await sleep(90);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(650);
    };

    const s0 = await cdp.call(inPageSnapshot);
    console.log(`▸ 视口 ${s0.viewport.w}×${s0.viewport.h} CSS`);
    console.log(`▸ 顶栏 ${s0.topbar.length} 个菜单：${s0.topbar.map((b) => b.t).join(' / ')}`);
    console.log(`▸ 参数工具行 ${s0.toolRow.length} 个：${s0.toolRow.map((b) => `${b.label}(${b.w}×${b.h})`).join(' ')}`);
    console.log(`▸ 底栏 ${s0.bottomBar.length} 个：${s0.bottomBar.map((b) => b.label).join(' / ')}`);
    console.log(`▸ 页签：${s0.tabs.map((t) => t.t).join(' / ')}`);
    console.log(`▸ 溢出视口的可见控件：${s0.outOfView.length} 个${s0.outOfView.length ? ' → ' + JSON.stringify(s0.outOfView.slice(0, 4)) : ''}`);

    // ① 工具模式切换：点另一个模式（不能点当前已激活的那个 —— 那是 no-op，会误判成"没生效"）
    const t0 = await cdp.call(inPageToolMode);
    console.log(`\n① 工具模式（点前）：${JSON.stringify(t0)}`);
    const active = t0.find((b) => b.pressed === 'true');
    const other = t0.find((b) => ['选择', '绘制'].includes(b.a) && b.pressed !== 'true');
    const target = s0.toolRow.find((b) => b.label === (other ? other.a : '选择'));
    if (target) {
        await tap(center(target));
        const t1 = await cdp.call(inPageToolMode);
        const changed = JSON.stringify(t0) !== JSON.stringify(t1);
        console.log(
            `   当前模式 ${active ? active.a : '?'} → 点「${target.label}」后：${JSON.stringify(t1)}  ⇒ ${changed ? '✅ 状态已变' : '❌ 无变化'}`,
        );
    }

    // ② ∨ 菜单开合并量溢出
    const vBtn = s0.toolRow.find((b) => b.label === '参数菜单');
    if (vBtn) {
        await tap(center(vBtn));
        const s1 = await cdp.call(inPageSnapshot);
        const panel = s1.menusOpen[0];
        const vmenu = await cdp.call(() => {
            const root = document.querySelector('.hs-param-rows');
            if (!root) return null;
            const r = root.getBoundingClientRect();
            const over = [...root.querySelectorAll('*')]
                .filter((e) => e.getBoundingClientRect().width > 0)
                .map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth))
                .filter((v) => v > 1);
            return { y: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom), overflowCount: over.length, maxOver: over.length ? Math.max(...over) : 0 };
        });
        console.log(`\n② ∨ 菜单：浮层 ${JSON.stringify(vmenu)} ⇒ ${vmenu && vmenu.overflowCount === 0 ? '✅ 零溢出' : '❌ 有溢出'}`);
        await tap(center(vBtn)); // 关掉
    }

    // ③ 👁 菜单：面板是否全在视口内 + 每行是否有「切换到」
    const eBtn = s0.toolRow.find((b) => b.label === '参数与覆盖层');
    if (eBtn) {
        await tap(center(eBtn));
        const eye = await cdp.call(() => {
            const m = [...document.querySelectorAll('[role=menu]')].find((x) => x.getAttribute('aria-label') === '参数与覆盖层');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            const bs = [...m.querySelectorAll('button')];
            return {
                top: Math.round(r.top),
                bottom: Math.round(r.bottom),
                inView: r.top >= 0 && r.bottom <= window.innerHeight,
               切换: bs.filter((b) => (b.textContent || '').trim() === '切换到').length,
                显隐: bs.filter((b) => /该参数曲线/.test(b.getAttribute('aria-label') || '')).length,
                气声: bs.filter((b) => /开启|关闭/.test((b.textContent || '').trim())).length,
            };
        });
        console.log(`③ 👁 菜单：${JSON.stringify(eye)} ⇒ ${eye && eye.inView ? '✅ 全在屏内' : '❌ 超出屏幕'}`);
        await tap(center(eBtn));
    }

    cdp.close();
}

await main();
