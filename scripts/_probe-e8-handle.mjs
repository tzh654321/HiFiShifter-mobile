#!/usr/bin/env node
/**
 * E8 验证（用户口径）：
 *   ① 分屏下**拖动「上工具栏」（param-toolbar 手柄）** ⇒ 分屏高度变化；
 *   ② 拖动**参数拍数栏** ⇒ 分屏高度**不变**（它已退出 HANDLE_SELECTOR）。
 *
 * 用法：node scripts\_probe-e8-handle.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';

const main = async () => {
    const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pid = adb('shell pidof com.arounder.hifishifter').trim();
    adb('forward tcp:9222 localabstract:webview_devtools_remote_' + pid);
    const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
    await cdp.send('Runtime.enable');
    const check = (n, ok, d) => console.log(`${ok ? '✅' : '🔴'} ${n}${d ? '\n     ' + d : ''}`);
    const touch = (type, pts) =>
        cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: Math.round(p.x), y: Math.round(p.y), radiusX: 6, radiusY: 6, force: 1 })),
        });
    const heights = () =>
        cdp.call(() => {
            const box = document.querySelector('[data-hs-mobile-split="1"]');
            if (!box) return null;
            return [...box.children].map((c) => Math.round(c.getBoundingClientRect().height));
        });
    const rectOf = (sel) =>
        cdp.call((s) => {
            const el = document.querySelector(s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        }, sel);
    /** 拖一条横条上下移动，返回高度采样。 */
    const dragHandle = async (at, dy) => {
        await touch('touchStart', [{ id: 0, x: at.x, y: at.y }]);
        await sleep(90);
        const samples = [];
        for (let i = 1; i <= 8; i++) {
            await touch('touchMove', [{ id: 0, x: at.x, y: at.y + (dy * i) / 8 }]);
            await sleep(70);
            samples.push(await heights());
        }
        await touch('touchEnd', []);
        await sleep(600);
        return samples;
    };

    // 确保分屏（轨道 + 参数）
    await cdp.call(async () => {
        window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
        await new Promise((r) => setTimeout(r, 2200));
    });
    let h0 = await heights();
    console.log('初始高度：' + JSON.stringify(h0));
    if (!h0 || h0.length < 2) {
        console.log('🔴 未形成分屏（需要轨道+参数同时打开）');
    }
    // ① 拖上工具栏
    const bar = await rectOf('[data-hs-split-handle="param-toolbar"]');
    console.log('上工具栏手柄：' + JSON.stringify(bar));
    if (bar && bar.h > 4 && h0 && h0.length >= 2) {
        const before = h0[0];
        const s = await dragHandle(bar, 60);
        const after = (await heights())[0];
        const distinct = new Set(s.filter(Boolean).map((x) => x[0])).size;
        check('E8-a 拖动「上工具栏」能调整分屏高度（连续跟手）', distinct >= 3 && after !== before, `前 ${before} → 后 ${after}；采样 ${JSON.stringify(s.map((x) => (x ? x[0] : null)))}`);
    } else {
        check('E8-a 拖动「上工具栏」能调整分屏高度', false, '上工具栏手柄不可见或未分屏');
    }
    // ② 拖参数拍数栏（应无效）
    const ruler = await rectOf('[data-hs-time-ruler="params"]');
    console.log('参数拍数栏：' + JSON.stringify(ruler));
    if (ruler && ruler.h > 4) {
        const before = (await heights())[0];
        await dragHandle(ruler, 60);
        const after = (await heights())[0];
        check('E8-b 拖动**参数拍数栏**不再改变分屏高度', after === before, `前 ${before} → 后 ${after}`);
    } else {
        console.log('（参数拍数栏不可见，跳过 E8-b）');
    }
    cdp.close();
};

await main();
