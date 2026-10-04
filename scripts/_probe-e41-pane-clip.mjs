#!/usr/bin/env node
/**
 * #3 验收：**面板块必须裁住溢出的内容**（否则内容画到下面的底栏 / 状态栏上）。
 *
 * 用户口径（2026-10-04 手测）：「**文件浏览器窗口拖到很窄时，窗口内容会盖在状态栏上**」。
 * 根因：面板块 `[data-hs-pane]` 只有 `animation`、**没有 `overflow`**，而各面板根是
 * `flex-col h-full` 且内部有多条 `shrink-0` 固定行 ⇒ 被拖矮到低于"固定行之和"时，
 * `min-h-0` 只能让中间滚动区缩到 0，固定行仍撑住内容盒 ⇒ 内容**向下溢出**面板。
 *
 * 判据（不依赖"把文件面板打开"这条链，直接量**包含关系**本身）：
 *   C1 面板块 computed `overflow` 不是 `visible`（= 真的会裁）
 *   C2 往面板块塞一个**远超其高度的绝对定位子元素** ⇒ 该子元素在面板**底边之下**
 *      的位置必须**命中不到它**（被裁）= 行为层证据，而不是只看 CSS 字符串
 *   C3 对照：塞进去的子元素在面板**内部**的位置仍应命中到它（证明 C2 不是"没插进去"）
 *
 * 用法：node scripts/_probe-e41-pane-clip.mjs [--serial 221deeb]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv;
let serial = '221deeb';
for (let i = 2; i < argv.length; i++) if (argv[i] === '--serial') serial = argv[++i];

const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim().replace(/\r/g, '');
if (!pid) throw new Error('应用没在跑');
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '🔴'} ${name}\n     ${detail}`);
};

/* 造一个"很高"的面板：把 timeline 面板压矮并不容易（那需要面板显隐配合），
   所以换个等价且更狠的做法 —— 直接量**面板自身**的裁剪行为：
   往 `[data-hs-pane]` 里塞一个高 2000px 的绝对定位子元素。 */
const r = await cdp.call(() => {
    const pane = document.querySelector('[data-hs-pane]');
    if (!pane) return { error: 'no-pane' };
    const pr = pane.getBoundingClientRect();
    const cs = getComputedStyle(pane);
    const oldPos = pane.style.position;
    if (cs.position === 'static') pane.style.position = 'relative';

    const probe = document.createElement('div');
    probe.setAttribute('data-hs-clip-probe', '1');
    probe.style.cssText =
        'position:absolute;left:0;top:0;width:12px;height:2000px;background:rgba(255,0,0,0.2);z-index:1;';
    pane.appendChild(probe);

    const x = Math.round(pr.left + 6);
    const insideY = Math.round(Math.min(pr.bottom - 20, pr.top + 20));
    const belowY = Math.round(pr.bottom + 6);
    /* ⚠️ 只能用 `elementsFromPoint`（**成员判定**）—— `elementFromPoint` 只给最顶层，
       而面板块自己的内容画在探针之上 ⇒ 永远拿不到探针（第一版就因此把对照判红）。
       `elementsFromPoint` 尊重裁剪：被 `overflow:hidden` 裁掉的元素不出现在列表里。 */
    const hasProbe = (yy) =>
        document
            .elementsFromPoint(x, yy)
            .some((el) => el.getAttribute && el.getAttribute('data-hs-clip-probe') === '1');
    const res = {
        paneRect: {
            left: Math.round(pr.left),
            top: Math.round(pr.top),
            bottom: Math.round(pr.bottom),
            h: Math.round(pr.height),
            w: Math.round(pr.width),
        },
        overflow: `${cs.overflowX}/${cs.overflowY}`,
        paneScrollH: pane.scrollHeight,
        paneClientH: pane.clientHeight,
        insideY,
        belowY,
        insideHasProbe: hasProbe(insideY),
        belowHasProbe: hasProbe(belowY),
        belowTop: (() => {
            const t = document.elementFromPoint(x, belowY);
            return t ? `${t.tagName}.${String(t.className).slice(0, 30)}` : null;
        })(),
    };
    probe.remove();
    pane.style.position = oldPos;
    return res;
});

if (r.error) throw new Error(r.error);

check(
    'C1 面板块 computed `overflow` != visible（真的会裁内容）',
    r.overflow !== 'visible/visible',
    `overflow=${r.overflow}  pane=[${r.paneRect.left},${r.paneRect.top}]→底 ${r.paneRect.bottom} h=${r.paneRect.h} w=${r.paneRect.w}  scrollH=${r.paneScrollH} clientH=${r.paneClientH}`,
);
check(
    'C3 对照：塞进面板**内部**的高子元素能被 `elementsFromPoint` 看到（证明探针确实插进去了）',
    r.insideHasProbe,
    `insideY=${r.insideY} insideHasProbe=${r.insideHasProbe}`,
);
check(
    'C2 关键：面板**底边之下**已看不到那个 2000px 子元素（= 内容被裁住，不会画到状态栏上）',
    !r.belowHasProbe,
    `belowY=${r.belowY} belowHasProbe=${r.belowHasProbe}（修复前应为 true） 该点顶层=${r.belowTop}  pane=[底 ${r.paneRect.bottom}]`,
);

const pass = results.filter((x) => x.ok).length;
console.log(`\n=== #3 面板块裁剪探针：通过 ${pass} / ${results.length} ===`);
for (const x of results) console.log(`${x.ok ? '✅' : '🔴'} ${x.name}`);
cdp.close();
process.exit(pass === results.length ? 0 : 1);
