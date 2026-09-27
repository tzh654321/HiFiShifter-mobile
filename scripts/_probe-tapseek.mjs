#!/usr/bin/env node
/**
 * 拍数栏「点一下就移动播放红线」验收（2026-09-21 用户口径）。
 *
 * 观测量：**播放头红线的 DOM 位置**。
 *   页面里播放头是 `[class*=bg-qt-playhead]` 的绝对定位元素（标尺里一条、画布里一条），
 *   它的 `getBoundingClientRect().left` 就是"红线在哪"。点拍数栏前后它必须变，
 *   而且应当**落在点击点附近**（这就是"点哪儿跳哪儿"）。
 *
 * 🕳️ 走过的弯路（别再犯）：
 *   ① 一开始拿"标尺上的 `0:0.000` 文本"当观测量 —— 那是**小节刻度标签**，
 *      与播放头无关、点前后恒定 ⇒ 把生效的 seek 误判成"未生效"。
 *   ② 后来改成"全文档时间样文本"，仍然不可靠：手机上走带区只渲染 1 个读数，
 *      且初始就是 `0:0.000`，点左边时新旧值可能撞在一起。
 *   ⇒ 只有**播放头元素自身的几何位置**是尺度无关、单调、无歧义的。
 *
 * 用法：node scripts/_probe-tapseek.mjs --serial emulator-5554 [--at 0.75] [--tab timeline|params]
 *   --at  点击位置占标尺宽度的比例（0..1，默认 0.75）
 *   --tab 哪个页签的拍数栏（timeline = 轨道界面；params = 参数界面）
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: 'emulator-5554', port: 9222, at: 0.75, tab: 'timeline', keep: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--at') o.at = Number(argv[++i]);
        else if (a === '--tab') o.tab = argv[++i];
        else if (a === '--keep') o.keep = true;
    }
    return o;
}

/**
 * 在页面里找拍数栏（标尺）。
 * ⚠️ 必须**自包含**：CDP 的 `Runtime.evaluate` 只求值这一个函数的源码，
 * 引用模块里的其它函数会得到 `xxx is not defined`（踩过）。
 */
function inPageFindRuler(tab) {
    const vp = tab === 'params'
        ? (window.__hsParamViewport ? window.__hsParamViewport() : null)
        : (window.__hsViewport ? window.__hsViewport() : null);
    if (!vp) return { error: 'no-viewport（页签不对？）' };
    const c = tab === 'params'
        ? (() => {
              const el = document.querySelector('[data-piano-roll-scroller]');
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { left: r.left, top: r.top, width: r.width, height: r.height };
          })()
        : vp.containerRect;
    if (!c) return { error: 'no-container' };
    // ⚠️ 候选必须同时满足三件事，否则会抓到**手机顶栏**（360×45 @ y=0，
    // 面积比拍数栏还大，实测被它骗过一次）：
    //   ① 被注册成手势表面 ⇒ 带 `touch-action: none`（拍数栏确实是这么挂的）
    //   ② 在滚动容器**上方**（拍数栏是容器的兄弟行）
    //   ③ 左边缘与容器对齐（顶栏从 x=0 起，容器从 x=132 起）
    const cands = [...document.querySelectorAll('*')]
        .filter((e) => e.style && e.style.touchAction === 'none')
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(
            (x) =>
                x.r.height > 8 &&
                x.r.height <= 68 &&
                x.r.width >= 120 &&
                x.r.top + x.r.height <= c.top + 2 &&
                Math.abs(x.r.left - c.left) <= 4,
        )
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    if (cands.length === 0) {
        return {
            error: 'no-ruler',
            container: { top: Math.round(c.top), left: Math.round(c.left) },
            wide: [...document.querySelectorAll('*')]
                .map((e) => ({ e, r: e.getBoundingClientRect() }))
                .filter((x) => x.r.width >= 120 && x.r.height >= 8 && x.r.height <= 68)
                .slice(0, 8)
                .map((x) => `${Math.round(x.r.width)}×${Math.round(x.r.height)} @${Math.round(x.r.left)},${Math.round(x.r.top)} [${String(x.e.className || '').slice(0, 30)}]`),
        };
    }
    const r = cands[0].r;
    return {
        left: r.left, top: r.top, w: r.width, h: r.height,
        cls: String(cands[0].e.className || '').slice(0, 50),
    };
}

/** 读播放头红线的 x（viewport 坐标）。同样必须自包含。 */
function inPageReadPlayhead() {
    const els = [...document.querySelectorAll('[class*=bg-qt-playhead]')].filter(
        (e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0,
    );
    const xs = els.map((e) => +e.getBoundingClientRect().left.toFixed(1));
    const times = [];
    for (const n of document.querySelectorAll('*')) {
        if (n.children.length) continue;
        const t = (n.textContent || '').trim();
        if (/^\d+:\d+\.\d+$/.test(t)) times.push(t);
    }
    return { xs, times };
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

    const ruler = await cdp.call(inPageFindRuler, o.tab);
    if (!ruler || ruler.error) {
        console.log('❌ 找不到拍数栏:', JSON.stringify(ruler, null, 1));
        cdp.close();
        process.exit(2);
    }
    const x = +(ruler.left + ruler.w * o.at).toFixed(1);
    const y = +(ruler.top + ruler.h / 2).toFixed(1);
    console.log(`▸ 拍数栏[${o.tab}] ${Math.round(ruler.w)}×${Math.round(ruler.h)} @ (${Math.round(ruler.left)},${Math.round(ruler.top)})  [${ruler.cls}]`);

    const before = await cdp.call(inPageReadPlayhead);
    console.log(`▸ 点前 播放头 x = ${JSON.stringify(before.xs)}  时间读数 ${JSON.stringify(before.times)}`);
    console.log(`▸ 点击 (${x}, ${y})`);

    // 单指轻点：touchStart → touchEnd（不移动 = 不触发手势）
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(600);

    const after = await cdp.call(inPageReadPlayhead);
    console.log(`▸ 点后 播放头 x = ${JSON.stringify(after.xs)}  时间读数 ${JSON.stringify(after.times)}`);

    const moved = before.xs.length > 0 && after.xs.length > 0 && before.xs.some((v, i) => Math.abs(v - (after.xs[i] ?? v)) > 1);
    const nearest = after.xs.length ? after.xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)) : null;
    const drift = nearest == null ? null : +(nearest - x).toFixed(1);

    if (!moved) {
        console.log('❌ 播放头没动 ⇒ seek 未生效');
    } else if (drift != null && Math.abs(drift) <= 6) {
        console.log(`✅ 播放头已移动到点击点（x ${before.xs.join('/')} → ${after.xs.join('/')}，偏差 ${drift} px）⇒ seek 生效且"点哪儿跳哪儿"`);
    } else if (drift != null && Math.abs(drift) <= 40) {
        console.log(`⚠️ 播放头动了，但落点差 ${drift} px（点击 ${x}，落点 ${nearest}）—— 拍数栏左右有 padding/内边距时会这样，需确认是否可接受`);
    } else {
        console.log(`⚠️ 播放头动了但落点差 ${drift} px（点击 ${x}，落点 ${nearest}）—— 方向/坐标系可能不对`);
    }
    cdp.close();
}

await main();
