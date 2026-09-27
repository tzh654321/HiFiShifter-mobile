#!/usr/bin/env node
/**
 * 手势层验收（CDP 注入双指，对照 docs/08 §8.1 不变量）。
 *
 * 前置：
 *   1) 已在设备装好 debug APK 并启动到前台（屏幕需点亮，否则 CDP 目标 visible=false）
 *   2) `node scripts/verify-gesture.mjs --serial 221deeb`
 *
 * 关键：手势坐标必须落在**手势层真正接管的容器**里。手势层 attach 时会把容器的
 * `style.touchAction` 置为 'none'，因此用这个特征就能精确定位它（比"找最大 canvas"可靠，
 * 画布不一定是该容器的子节点）。
 *
 * 判定（docs/08 §2.2 / §8.1）：
 *   - 水平捏合(中点固定): (scrollLeft+midX)/pxPerSec 不变；rowHeight 不变
 *   - 竖直捏合(中点固定): (scrollTop+midY)/rowHeight 不变；pxPerSec 不变
 *   - 双指平移:           pxPerSec/rowHeight 不变；scrollLeft/scrollTop 按位移移动
 *
 * 注意：mid 必须与 scrollLeft/scrollTop 同域（容器坐标系），故要减去容器偏移。
 */

import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const o = { serial: '221deeb', host: '127.0.0.1', port: 9222, steps: 14, hold: 60 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--serial') o.serial = argv[++i];
        else if (a === '--host') o.host = argv[++i];
        else if (a === '--port') o.port = Number(argv[++i]);
        else if (a === '--steps') o.steps = Number(argv[++i]);
        else if (a === '--hold') o.hold = Number(argv[++i]);
    }
    return o;
}

async function fwd(serial) {
    const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
    if (!pid) throw new Error('应用未运行（pidof 空）—— 先启动 App');
    execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`).toString();
    console.log(`▸ adb forward: tcp:9222 → webview_devtools_remote_${pid}`);
}

/**
 * 定位手势层接管的容器（touchAction==='none'）并返回其中心与 rect。
 *
 * 🕳️ **不能用 `find()` 取"第一个"**：参数面板里的**增益旋钮（32×32）**、滑条等小控件
 * 也带 `touch-action: none`，而文档顺序上它们可能排在时间线表面之前 ⇒ 手势被注入进一个
 * 32px 的旋钮，三项捏合/平移全部判"失败"。实测（2026-09-21 真机）：报
 * ```
 * ▸ 手势容器 32×32 @ (8,134.5)  [relative w-8 h-8 rounded-full border bor]
 * 🔴 水平捏合 … 🔴 双指水平平移 …
 * ```
 * —— **差点当成"同步上游把手势改坏了"的回归**，而 `probe-ui` 同期七项全绿。
 *
 * 判据改为：优先已知表面选择器 `[data-piano-roll-scroller]`，否则取**面积最大**的候选，
 * 且必须有像样的尺寸（小于阈值就报 `no-surface` 并把候选列出来，方便区分
 * "手势层没挂上" / "判据不对"，而不是静默注入到一个小控件里）。
 */
function inPageGestureTarget() {
    const MIN_W = 160;
    const MIN_H = 120;
    const withRect = (e) => {
        const r = e.getBoundingClientRect();
        return { e, r, area: r.width * r.height };
    };
    const all = [...document.querySelectorAll('*')]
        .filter((e) => e.style && e.style.touchAction === 'none')
        .map(withRect)
        .filter((x) => x.r.width > 1 && x.r.height > 1)
        .sort((a, b) => b.area - a.area);

    const fits = (x) => x.r.width >= MIN_W && x.r.height >= MIN_H;

    const preferred = document.querySelector('[data-piano-roll-scroller]');
    let pick = null;
    if (preferred && preferred.style && preferred.style.touchAction === 'none') {
        const p = withRect(preferred);
        if (fits(p)) pick = p;
    }
    if (!pick) pick = all.find(fits) || null;

    if (!pick) {
        return {
            error: 'no-surface',
            vp: [window.innerWidth, window.innerHeight],
            candidates: all
                .slice(0, 6)
                .map((x) => `${Math.round(x.r.width)}×${Math.round(x.r.height)}  ${String(x.e.className || '').slice(0, 34)}`),
        };
    }
    const r = pick.r;
    return {
        x: +(r.left + r.width / 2).toFixed(1),
        y: +(r.top + r.height / 2).toFixed(1),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        left: +r.left.toFixed(1),
        top: +r.top.toFixed(1),
        cls: String(pick.e.className || '').slice(0, 40),
        candCount: all.length,
    };
}

async function main() {
    const o = parseArgs(process.argv);
    await fwd(o.serial);

    const cdp = await Cdp.attach({ host: o.host, port: o.port });
    await cdp.send('Runtime.enable');
    // ⚠️ CDP 的 Input 域**没有** enable 方法（调了会报 'Input.enable' wasn't found）。
    try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
        /* 某些 WebView 不暴露 Emulation 域，忽略 */
    }

    const vp = await cdp.call(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
    console.log(`▸ 视口 ${vp.w}×${vp.h} CSS (dpr ${vp.dpr})`);

    const tgt = await cdp.call(inPageGestureTarget);
    if (!tgt || tgt.error) {
        console.log('❌ 没找到**够大的**手势容器（touchAction=none 且 ≥160×120）—— 手势层没挂上？');
        if (tgt && tgt.candidates && tgt.candidates.length) {
            console.log('   候选（按面积降序）：');
            for (const c of tgt.candidates) console.log(`     · ${c}`);
        }
        console.log('   提示：参数页签下时间线表面可能不在 DOM 里；先切到时间线页签再跑。');
        cdp.close();
        process.exit(2);
    }
    console.log(`▸ 手势容器 ${tgt.w}×${tgt.h} @ (${tgt.left},${tgt.top})  [${tgt.cls}]  （候选 ${tgt.candCount} 个，取最大）`);
    const cx = tgt.x;
    const cy = tgt.y;
    // 锚点换算到容器坐标系（与 scrollLeft/scrollTop 同域）
    const ax = +(cx - tgt.left).toFixed(1);
    const ay = +(cy - tgt.top).toFixed(1);
    console.log(`▸ 手势中点 = (${cx}, ${cy})  锚点(容器系) = (${ax}, ${ay})`);

    // 手势幅度按容器尺寸自适应（容器可能很小）
    const maxR = Math.max(12, Math.min(tgt.w, tgt.h) / 2 - 8);
    const r1 = +(maxR * 0.35).toFixed(1);
    const r2 = +(maxR * 0.85).toFixed(1);
    console.log(`▸ 捏合半径 ${r1} → ${r2} (maxR=${maxR.toFixed(1)})`);

    const readVP = async () => {
        // 🕳️ 读之前先让内核/React 落定：`dispatchTouchEvent` 返回时浏览器**未必**已经把
        // 最后一个 touchMove 处理完，立刻读会拿到"手势中途"的快照 ⇒ 锚点漂移被高估
        // （实测真机 0.0126 s 刚好越过旧阈值，看起来像回归）。
        await new Promise((r) => setTimeout(r, 180));
        return cdp.call(() => (window.__hsViewport ? window.__hsViewport() : null));
    };

    async function touch(type, points, timeoutMs = 15000) {
        await cdp.send(
            'Input.dispatchTouchEvent',
            {
                type,
                touchPoints: points.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
            },
            timeoutMs,
        );
    }

    /**
     * 双指序列：先落第一指，再加第二指（CDP 按"与上一事件的差异"生成 touchstart），
     * 然后同步 move，最后 touchEnd([]) 释放全部。
     */
    async function drive(pts, durMs = 400) {
        const n = Math.max(2, o.steps);
        await touch('touchStart', [pts(0)[0]]);
        await sleep(o.hold);
        await touch('touchStart', pts(0));
        await sleep(o.hold);
        for (let i = 1; i <= n; i++) {
            await touch('touchMove', pts(i / n));
            await sleep(durMs / n);
        }
        await sleep(60);
        await touch('touchEnd', []);
        await sleep(250); // 给 React 一帧提交 + 冷却期(150ms)
    }

    const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
    const results = [];

    // ───────── 1) 水平捏合（中点固定，X 分离度变化）─────────────
    {
        const v0 = await readVP();
        await drive((k) => [
            { id: 1, x: cx - (r1 + (r2 - r1) * k), y: cy },
            { id: 2, x: cx + (r1 + (r2 - r1) * k), y: cy },
        ]);
        const v1 = await readVP();
        const sec0 = (v0.scrollLeft + ax) / v0.pxPerSec;
        const sec1 = (v1.scrollLeft + ax) / v1.pxPerSec;
        const row0 = (v0.scrollTop + ay) / v0.rowHeight;
        const row1 = (v1.scrollTop + ay) / v1.rowHeight;
        const zoomed = v1.pxPerSec !== v0.pxPerSec;
        // 🕳️ 判据用**像素**，不用秒：秒不是尺度无关的量 —— 同一个像素误差，缩放越大
        // 折算出的秒数越小，于是"阈值 0.01 秒"在高缩放下变成比 1px 还苛刻的尺子。
        // 用户能感知的是「捏合时中点下面的内容有没有跟着跑」，所以量的是位移像素数。
        const driftPx = Math.abs(sec1 - sec0) * v1.pxPerSec;
        const ok =
            zoomed && // 确实缩放了
            driftPx <= 2 && // 中点漂移 ≤ 2 CSS px
            approx(v0.rowHeight, v1.rowHeight) && // 行高不变
            approx(row0, row1, 1e-2); // 中点行号不变
        results.push([
            '水平捏合(中点固定)',
            ok,
            {
                pxPerSec: `${v0.pxPerSec}→${v1.pxPerSec}`,
                secAtMid: `${sec0.toFixed(4)}→${sec1.toFixed(4)}`,
                drift: `${driftPx.toFixed(2)} px（阈值 2）`,
                rowHeight: `${v0.rowHeight}→${v1.rowHeight}`,
            },
        ]);
    }

    // ───────── 2) 竖直捏合（中点固定，Y 分离度变化）─────────────
    {
        const v0 = await readVP();
        // rowHeight 已顶到上限时改用合拢方向——张开会被 MAX_ROW_HEIGHT 钳成"没动作"。
        const pinchIn = v0.rowHeight >= 190; // 上限 192，留 2px 容差
        const ra = pinchIn ? r2 : r1;
        const rb = pinchIn ? r1 : r2;
        await drive((k) => [
            { id: 1, x: cx, y: cy - (ra + (rb - ra) * k) },
            { id: 2, x: cx, y: cy + (ra + (rb - ra) * k) },
        ]);
        const v1 = await readVP();
        const row0 = (v0.scrollTop + ay) / v0.rowHeight;
        const row1 = (v1.scrollTop + ay) / v1.rowHeight;
        const sec0 = (v0.scrollLeft + ax) / v0.pxPerSec;
        const sec1 = (v1.scrollLeft + ax) / v1.pxPerSec;
        const zoomed = Math.abs(v1.rowHeight - v0.rowHeight) > 0.5;
        // 行高变化后，若理论 scrollTop 为负（锚点行跑到内容上方），内核必然把它钳到 0，
        // 锚点不变量物理上不可能成立 —— 此时只验证"滚动被正确钳在边界"。
        const expectedTop = row0 * v1.rowHeight - ay;
        const clampedLow = expectedTop < 0;
        // v1.scrollTop===0：上界钳（空工程内容总高 < 视口，maxScroll=0），锚点同样物理不可能。
        // 等工程有多轨内容（scrollTop>0）后，此豁免自动失效，断言恢复严格。
        const anchorOk = clampedLow
            ? v1.scrollTop <= 0.5
            : (approx(row0, row1, 1e-2) || v1.scrollTop <= 0.5);
        const ok =
            zoomed && // 确实缩放了行高（任一方向）
            anchorOk &&
            approx(v0.pxPerSec, v1.pxPerSec) && // 水平缩放不变
            approx(sec0, sec1, 1e-2); // 中点秒数不变
        results.push([
            `竖直捏合(中点固定,${pinchIn ? '合拢' : '张开'})`,
            ok,
            { rowHeight: `${v0.rowHeight}→${v1.rowHeight}`, rowAtMid: `${row0.toFixed(4)}→${row1.toFixed(4)}`, pxPerSec: `${v0.pxPerSec}→${v1.pxPerSec}` },
        ]);
    }

    // ───────── 3) 双指水平平移（分离度不变 → kx=ky=1，纯平移）─────────────
    {
        const dx = +Math.min(30, tgt.w * 0.25).toFixed(1);
        const gap = +(maxR * 0.25).toFixed(1);
        const v0 = await readVP();
        await drive((k) => [
            { id: 1, x: cx - gap + dx * k, y: cy },
            { id: 2, x: cx + gap + dx * k, y: cy },
        ]);
        const v1 = await readVP();
        const d = v1.scrollLeft - v0.scrollLeft;
        const ok =
            approx(v0.pxPerSec, v1.pxPerSec) && // 没缩放
            approx(v0.rowHeight, v1.rowHeight) && // 没缩放
            d < -1; // 手指向右 → 内容左移 → scrollLeft 减小
        results.push([
            '双指水平平移',
            ok,
            {
                scrollLeft: `${v0.scrollLeft.toFixed(1)}→${v1.scrollLeft.toFixed(1)} (Δ${d.toFixed(1)})`,
                期望位移: `-${dx}`,
                pxPerSec: `${v0.pxPerSec}→${v1.pxPerSec}`,
            },
        ]);
    }

    // ───────── 4) 双指竖直平移 ─────────────
    {
        const dy = -Math.min(30, tgt.h * 0.25);
        const gap = +(maxR * 0.25).toFixed(1);
        const v0 = await readVP();
        await drive((k) => [
            { id: 1, x: cx, y: cy - gap + dy * k },
            { id: 2, x: cx, y: cy + gap + dy * k },
        ]);
        const v1 = await readVP();
        const d = v1.scrollTop - v0.scrollTop;
        // 空工程时内容高度 < 视口，scrollTop 恒 0 属正常 —— 标"跳过"不算失败
        // （手势通路已由水平平移用例验证）。
        const noContent = v0.scrollTop === 0 && Math.abs(d) < 1;
        const ok =
            approx(v0.pxPerSec, v1.pxPerSec) &&
            approx(v0.rowHeight, v1.rowHeight) &&
            (d > 1 || noContent);
        results.push([
            noContent ? '双指竖直平移(内容不足,跳过)' : '双指竖直平移',
            ok,
            {
                scrollTop: `${v0.scrollTop.toFixed(1)}→${v1.scrollTop.toFixed(1)} (Δ${d.toFixed(1)})`,
                期望位移: `+${(-dy).toFixed(1)}`,
                rowHeight: `${v0.rowHeight}→${v1.rowHeight}`,
            },
        ]);
    }

    console.log('\n════════ 验收结果 ════════');
    let allOk = true;
    for (const [name, ok, detail] of results) {
        console.log(`${ok ? '✅' : '🔴'} ${name}`);
        console.log(`     ${JSON.stringify(detail)}`);
        if (!ok) allOk = false;
    }
    console.log('════════════════════════');
    console.log(allOk ? '✅ 全部通过：双指手势层锚点不变量成立' : '🔴 有失败项，见上');

    cdp.close();
    process.exit(allOk ? 0 : 1);
}

process.exit(await main().catch((e) => {
    console.error(`❌ ${e.message}`);
    return 2;
}));
