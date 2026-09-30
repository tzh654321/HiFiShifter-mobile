#!/usr/bin/env node
/**
 * E19b 设备验收：「选择」的切换与「绘制」**同一套语义**。
 *
 * 用户口径（E19b）：点**未选中**的工具 ⇒ **直接切换**；点**选中**工具的**角标** ⇒ **展开工具菜单**；
 * 菜单展开后**点别处收起**。「选择」必须与「绘制」一致。
 *
 * 代码位置（本轮核对）：`components/mobile/MobileBottomBar.tsx`
 *   · 「选择」按钮 `aria-label="选择"`（`BarButton` ⇒ `aria-pressed` = 是否激活），
 *     角标 `[data-hs-select-corner]`（14×14，`onClick` 自己 `stopPropagation` 后开菜单）；
 *   · 「绘制」按钮 `aria-label="绘制"`，角标 `[data-hs-draw-corner]`；
 *   · 工具菜单容器 `aria-label="绘制工具"`（两个菜单共用同一文案），
 *     并且**自带全屏透明 backdrop**（`inset:0; z-index:40`）⇒ "点别处"落到 backdrop 上即收起。
 *   · 按钮 40×40，而角标命中区只到 `bottom-right 18×18` ⇒ **中心点安全**（20 < 22）。
 *
 * 用法：node scripts/_probe-e19b-toolswitch.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`)
    .toString()
    .trim()
    .replace(/\r/g, '');
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
        touchPoints: pts.map((p, i) => ({
            id: p.id ?? i,
            x: Math.round(p.x),
            y: Math.round(p.y),
            radiusX: 6,
            radiusY: 6,
            force: 1,
        })),
    });
const tap = async (x, y, hold = 70) => {
    await touch('touchStart', [{ x, y }]);
    await sleep(hold);
    await touch('touchEnd', []);
    await sleep(700);
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* 0. 参数面板在场 */
await cdp.call(async () => {
    window.dispatchEvent(new CustomEvent('hs-mobile-switch-tab', { detail: { tab: 'params' } }));
    await new Promise((r) => setTimeout(r, 3200));
});

const snap = () =>
    cdp.call(() => {
        const btn = (lab) => document.querySelector(`button[aria-label="${lab}"]`);
        const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
                l: Math.round(r.left),
                t: Math.round(r.top),
                r: Math.round(r.right),
                b: Math.round(r.bottom),
                cx: Math.round(r.left + r.width / 2),
                cy: Math.round(r.top + r.height / 2),
                w: Math.round(r.width),
                h: Math.round(r.height),
            };
        };
        const pressed = (lab) => {
            const b = btn(lab);
            return b ? b.getAttribute('aria-pressed') === 'true' : null;
        };
        return {
            sel: box(btn('选择')),
            draw: box(btn('绘制')),
            selCorner: box(document.querySelector('[data-hs-select-corner]')),
            drawCornerMark: box(document.querySelector('[data-hs-draw-corner]')),
            selOn: pressed('选择'),
            drawOn: pressed('绘制'),
            /* 两个菜单的判据**不同源**（容易漏判）：
               · `SelectToolMenu` 只有 `data-hs-select-tool-menu`（无 role / aria-label）；
               · `DrawToolMenu` 只有 `aria-label="绘制工具"`（`t("mobile_tool_menu")`）。 */
            menuSelect: Boolean(document.querySelector('[data-hs-select-tool-menu]')),
            menuDraw: Boolean(document.querySelector('[aria-label="绘制工具"]')),
            menu:
                Boolean(document.querySelector('[data-hs-select-tool-menu]')) ||
                Boolean(document.querySelector('[aria-label="绘制工具"]')),
            drawTool:
                document.querySelector('[data-hs-draw-tool]')?.getAttribute('data-hs-draw-tool') ??
                null,
            pane: box(document.querySelector('[data-hs-pane="params"]')),
        };
    });

const s0 = await snap();
console.log('▸ 初始：' + JSON.stringify(s0));
check(
    'E19b-0 参数工具行在场（选择 / 绘制按钮都能定位）',
    Boolean(s0.sel && s0.draw),
    JSON.stringify({ sel: s0.sel, draw: s0.draw, drawTool: s0.drawTool }),
);
if (!(s0.sel && s0.draw)) {
    cdp.close();
    process.exit(1);
}

/* 命中点：**按钮本体取左上内缩 8px**（右下角是角标命中区，见下），
   角标取几何右下 6px（「绘制」在「还原」工具下不渲染 `data-hs-draw-corner`，
   但 `onPencilClick` 仍按 `bottom-right 18×18` 判定角标 ⇒ 几何法通用）。 */
const bodyPt = (b) => ({ x: b.l + 8, y: b.t + 8 });
const cornerPt = (b) => ({ x: b.r - 6, y: b.b - 6 });
const selBody = bodyPt(s0.sel);
const selCorner = s0.selCorner ? { x: s0.selCorner.cx, y: s0.selCorner.cy } : cornerPt(s0.sel);
const drawBody = bodyPt(s0.draw);
const drawCorner = cornerPt(s0.draw);
console.log(
    '▸ 命中点：' +
        JSON.stringify({ selBody, selCorner, drawBody, drawCorner, selCornerMark: s0.selCorner }),
);

/* 1. 点未选中的「选择」⇒ 直接切换（不弹菜单） */
if (s0.selOn !== true) {
    await tap(selBody.x, selBody.y);
    const s1 = await snap();
    check(
        'E19b-1 点**未选中**的「选择」⇒ 直接切换（且不弹菜单）',
        s1.selOn === true && s1.menu === false,
        JSON.stringify({ selOn: s1.selOn, drawOn: s1.drawOn, menu: s1.menu }),
    );
} else {
    check('E19b-1 点**未选中**的「选择」⇒ 直接切换（且不弹菜单）', true, '（进入时已是「选择」，跳过）');
}

/* 2. 点「选择」右下角标 ⇒ 展开选择菜单 */
await tap(selCorner.x, selCorner.y);
const s2 = await snap();
check(
    'E19b-2 点「选择」**右下角标**⇒ 展开工具菜单',
    s2.menuSelect === true,
    JSON.stringify({ menuSelect: s2.menuSelect, menuDraw: s2.menuDraw, selOn: s2.selOn }),
);

/* 3. 点别处 ⇒ 收起 */
/* 「别处」取参数面板**左上角内缩 8px** 的位置：不落到画布上（避免顺手画一个点），
   也一定在菜单 backdrop（`inset:0`，z-index 40）之内。 */
const awayX = s0.pane ? s0.pane.l + 8 : 8;
const awayY = s0.pane ? s0.pane.t + 8 : 8;
await tap(awayX, awayY);
const s3 = await snap();
check('E19b-3 菜单展开后**点别处**⇒ 收起', s3.menu === false, JSON.stringify({ menu: s3.menu }));

/* 4. 点未选中的「绘制」⇒ 直接切换 */
if (s3.drawOn !== true) {
    await tap(drawBody.x, drawBody.y);
    const s4 = await snap();
    check(
        'E19b-4 点**未选中**的「绘制」⇒ 直接切换（且不弹菜单）',
        s4.drawOn === true && s4.menu === false,
        JSON.stringify({ drawOn: s4.drawOn, selOn: s4.selOn, menu: s4.menu, drawTool: s4.drawTool }),
    );
} else {
    check('E19b-4 点**未选中**的「绘制」⇒ 直接切换（且不弹菜单）', true, '（进入时已是「绘制」，跳过）');
}

/* 5. 点「绘制」右下角标 ⇒ 展开绘制菜单 */
await tap(drawCorner.x, drawCorner.y);
const s5 = await snap();
check(
    'E19b-5 点「绘制」**右下角标**⇒ 展开工具菜单',
    s5.menuDraw === true,
    JSON.stringify({
        menuSelect: s5.menuSelect,
        menuDraw: s5.menuDraw,
        drawOn: s5.drawOn,
        drawCornerMark: Boolean(s0.drawCornerMark),
    }),
);

/* 6. 点别处 ⇒ 收起 */
await tap(awayX, awayY);
const s6 = await snap();
check('E19b-6 菜单展开后**点别处**⇒ 收起', s6.menu === false, JSON.stringify({ menu: s6.menu }));

console.log(`\n── E19b 汇总：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
