#!/usr/bin/env node
/**
 * F2 补全：把长按检测放进 **`FoldPanel`**（承载 `items.map` 的那个组件）。
 *
 * 上一轮失败原因：refs 与长按处理插到了 `trackFoldItems` 所在组件（那是**另一个**组件），
 * 渲染却在 `FoldPanel` 里 ⇒ 作用域对不上、编译报 "Cannot find name"。这次按正确作用域来。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let lines = readFileSync(path, 'utf8').split('\n');

// ① 找 FoldPanel 的组件体开头（函数签名之后的第一个 `) {` 行）
const sigAt = lines.findIndex((l) => /^function FoldPanel\(/.test(l));
if (sigAt < 0) {
    console.log('⚠️ 未找到 FoldPanel');
    process.exit(1);
}
let bodyAt = -1;
for (let i = sigAt; i < sigAt + 20; i++) {
    if (/^\}\: React\.FC|^\)\s*\{|^\}\s*\{/.test(lines[i]) || /^\}\s*\)\s*\{/.test(lines[i])) {
        bodyAt = i;
        break;
    }
}
if (bodyAt < 0) {
    // 退化：找签名后第一个以 `{` 结尾且缩进为 0 的行
    for (let i = sigAt; i < sigAt + 20; i++) {
        if (lines[i].trim().endsWith('{')) {
            bodyAt = i;
            break;
        }
    }
}
if (bodyAt < 0) {
    console.log('⚠️ 未找到 FoldPanel 体开头');
    process.exit(1);
}
lines.splice(
    bodyAt + 1,
    0,
    '    /* F2（用户口径）：^ 菜单里的项支持**长按打开另一个菜单**（该项的设置）。',
    '       长按门槛与其它手势一致（260ms + 震动）；长按成立时**吃掉**随后的那次 onClick，',
    '       否则松手会顺手把开关翻掉。未提供 `longPress` 的项走通用路径（打开工程设置浮层）。 */',
    '    const longPressTimerRef = React.useRef<number | null>(null);',
    '    const longPressFiredRef = React.useRef<string | null>(null);',
);
console.log(`FoldPanel 体开头 = L${bodyAt + 1}，refs 已插入`);

// ② 渲染处 onClick 换成带长按语义的版本
const clickAt = lines.findIndex((l) => /^\s*onClick=\{item\.act\}\s*$/.test(l));
if (clickAt < 0) {
    console.log('⚠️ 未找到 onClick={item.act}');
} else {
    const ind = (lines[clickAt].match(/^\s*/) ?? [''])[0];
    lines.splice(
        clickAt,
        1,
        `${ind}/* 长按 = 打开该项的"另一个菜单"；长按成立时吃掉这次 click。 */`,
        `${ind}onClick={() => {`,
        `${ind}    if (longPressFiredRef.current === item.id) {`,
        `${ind}        longPressFiredRef.current = null;`,
        `${ind}        return;`,
        `${ind}    }`,
        `${ind}    item.act();`,
        `${ind}}}`,
        `${ind}onPointerDown={() => {`,
        `${ind}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${ind}    longPressTimerRef.current = window.setTimeout(() => {`,
        `${ind}        longPressTimerRef.current = null;`,
        `${ind}        longPressFiredRef.current = item.id;`,
        `${ind}        try {`,
        `${ind}            (navigator as unknown as { vibrate?: (p: number) => boolean }).vibrate?.(12);`,
        `${ind}        } catch {`,
        `${ind}            /* 忽略：部分 WebView 无振动权限 */`,
        `${ind}        }`,
        `${ind}        if (item.longPress) {`,
        `${ind}            item.longPress();`,
        `${ind}            return;`,
        `${ind}        }`,
        `${ind}        /* 未提供专属菜单 ⇒ 打开「工程设置」浮层（含网格/拍数等时间轴设置）；`,
        `${ind}           「吸附网格…」语义正好对上，「分割过渡…」的专属设置待补。 */`,
        `${ind}        window.dispatchEvent(`,
        `${ind}            new CustomEvent("hs-open-settings", { detail: { which: "project" } }),`,
        `${ind}        );`,
        `${ind}    }, 260);`,
        `${ind}}}`,
        `${ind}onPointerUp={() => {`,
        `${ind}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${ind}    longPressTimerRef.current = null;`,
        `${ind}}}`,
        `${ind}onPointerCancel={() => {`,
        `${ind}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${ind}    longPressTimerRef.current = null;`,
        `${ind}}}`,
    );
    console.log(`长按处理已插入（原 L${clickAt + 1}）`);
}

writeFileSync(path, lines.join('\n'), 'utf8');
console.log('完成');
