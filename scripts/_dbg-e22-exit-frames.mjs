#!/usr/bin/env node
/**
 * E22 第二刀 · 取证脚本：把"面板收起"那 1 秒内**每一帧**都打出来。
 *
 * 要回答两个问题（`_probe-e22-exit.mjs` 只给了汇总，看不出中间的机制）：
 *   Q1 淡出中的面板节点**是不是同一个节点**（`tag` 掉了 ⇒ 被 React 换了节点）；
 *   Q2 高度/透明度**逐帧**怎么变的（X4 报 419→299，怀疑是 App 自己那段
 *      "单面板归位"直接改 DOM 的 `flexGrow`）。
 *
 * 用法：node scripts/_dbg-e22-exit-frames.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? '221deeb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const switchTab = async (tab) => {
    await cdp.call(
        (t) => {
            window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: t } }));
            return true;
        },
        tab,
    );
    await sleep(1200);
};
await switchTab('params');
await switchTab('timeline');

/* 装采样器：给当前节点打 `__exTag`，每帧记录它还认不认得 */
await cdp.call(() => {
    const el = document.querySelector('[data-hs-pane="timeline"]');
    if (el) el.__exTag = 'A';
    window.__frames = [];
    const t0 = performance.now();
    const tick = () => {
        const now = document.querySelector('[data-hs-pane="timeline"]');
        window.__frames.push({
            dt: Math.round(performance.now() - t0),
            present: !!now,
            sameNode: now ? now.__exTag === 'A' : null,
            leaving: now ? now.hasAttribute('data-hs-leaving') : null,
            inlineGrow: now ? now.style.flexGrow || '(空)' : null,
            h: now ? Math.round(now.getBoundingClientRect().height) : null,
            op: now ? Number(getComputedStyle(now).opacity) : null,
            anims: now ? now.getAnimations().map((a) => a.animationName) : [],
        });
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
});

const before = await cdp.call(() => {
    const c = document.querySelector('[data-hs-mobile-split]');
    return {
        kids: c ? [...c.children].map((e) => e.getAttribute('data-hs-pane') ?? e.tagName) : [],
        kidsGrow: c ? [...c.children].map((e) => e.style.flexGrow || '(空)') : [],
        rect: c ? Math.round(c.getBoundingClientRect().height) : 0,
    };
});
console.log('▸ 关闭前容器子元素：' + JSON.stringify(before));

await cdp.call(() => {
    window.dispatchEvent(new CustomEvent('hs-mobile-close-panel', { detail: { key: 'timeline' } }));
    return true;
});
await sleep(1100);

const frames = await cdp.call(() => window.__frames || []);
const after = await cdp.call(() => {
    const c = document.querySelector('[data-hs-mobile-split]');
    return {
        kids: c ? [...c.children].map((e) => e.getAttribute('data-hs-pane') ?? e.tagName) : [],
        kidsGrow: c ? [...c.children].map((e) => e.style.flexGrow || '(空)') : [],
    };
});
console.log('▸ 关闭后容器子元素：' + JSON.stringify(after));
console.log(`▸ 共 ${frames.length} 帧（只打前 26 帧 + 后 3 帧）`);
for (const [i, f] of frames.entries()) {
    if (i > 25 && i < frames.length - 3) continue;
    console.log(
        `   dt=${String(f.dt).padStart(4)} present=${f.present ? 1 : 0} sameNode=${f.sameNode === null ? '-' : f.sameNode ? 1 : 0}` +
            ` leaving=${f.leaving === null ? '-' : f.leaving ? 1 : 0} grow=${f.inlineGrow} h=${f.h} op=${f.op} anims=${JSON.stringify(f.anims)}`,
    );
}
cdp.close();
