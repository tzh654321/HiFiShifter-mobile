#!/usr/bin/env node
/** 批量修探针：浮条查内层、控制点用合成 PointerEvent（已验证有效）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'scripts/_probe-e5-e6-g1-f2.mjs';
let t = readFileSync(p, 'utf8');

// ① 浮条检测：外层是 0×0（子元素 fixed 不撑父级）⇒ 必须查**内层**
t = t.replace(
    `        const lr = box(l), rr = box(r), br = box(bar);`,
    `        const lr = box(l), rr = box(r);
        /* ⚠️ 浮条**外层**永远 0×0（子元素是 fixed 定位，不撑父级）⇒ 必须看内层。 */
        const inner = bar ? bar.querySelector("div") : null;
        const br = inner ? inner.getBoundingClientRect() : null;`,
);

// ② 控制点：改用合成 PointerEvent（CDP 触摸打不中它，实测合成 pointerdown 有效）
t = t.replace(
    `    if (dots.left) {
        const gx = dots.left.x + 7, gy = dots.left.y + 7;
        await touch('touchStart', [{ id: 0, x: gx, y: gy }]);
        await sleep(80);
        await touch('touchMove', [{ id: 0, x: gx + 4, y: gy - 46 }]);
        await sleep(260);`,
    `    if (dots.left) {
        const gx = dots.left.x + 7, gy = dots.left.y + 7;
        /* 用**合成 PointerEvent**：CDP 的触摸事件打不中控制点（实测合成有效）。 */
        await cdp.call(async (x, y) => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const ev = (type, cx, cy) =>
                new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerType: "touch",
                    pointerId: 71,
                    isPrimary: true,
                    clientX: cx,
                    clientY: cy,
                    button: 0,
                });
            window.dispatchEvent(ev("pointerdown", x, y));
            await wait(120);
            window.dispatchEvent(ev("pointermove", x + 3, y - 46));
            await wait(260);
        }, gx, gy);`,
);
t = t.replace(
    `        await touch('touchEnd', []);
        await sleep(500);
        const end = await cdp.call(`,
    `        await cdp.call(() =>
            window.dispatchEvent(
                new PointerEvent("pointerup", {
                    bubbles: true,
                    cancelable: true,
                    pointerType: "touch",
                    pointerId: 71,
                    isPrimary: true,
                    clientX: 0,
                    clientY: 0,
                    button: 0,
                }),
            ),
        );
        await sleep(500);
        const end = await cdp.call(`,
);

// ③ 「更多」按钮：也用合成 click（浮条内层是真实 DOM，click 可行）
t = t.replace(
    `    if (moreBtn) {
        await touch('touchStart', [{ id: 0, x: moreBtn.x, y: moreBtn.y }]);
        await sleep(70);
        await touch('touchEnd', []);
        await sleep(1600);`,
    `    if (moreBtn) {
        await cdp.call((x, y) => {
            const el = document.elementFromPoint(x, y);
            const btn = el && el.closest ? el.closest("button") : null;
            (btn ?? el)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }, moreBtn.x, moreBtn.y);
        await sleep(1600);`,
);

writeFileSync(p, t, 'utf8');
console.log(`内层检测=${t.includes('const inner = bar')}  合成pointer=${t.includes('pointerId: 71')}  合成click=${t.includes('elementFromPoint')}`);
