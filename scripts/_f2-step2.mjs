#!/usr/bin/env node
/** F2 第二步：按行号插入长按处理（渲染处那段源码在文件里是乱码，正则匹配不可靠）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let lines = readFileSync(path, 'utf8').split('\n');

// ① 在 `const trackFoldItems: FoldItem[] = [` 之前插入 refs + state + 通用菜单渲染器
const itemsAt = lines.findIndex((l) => /const trackFoldItems: FoldItem\[\] = \[/.test(l));
if (itemsAt < 0) {
    console.log('⚠️ 未找到 trackFoldItems');
} else {
    lines.splice(
        itemsAt,
        0,
        '    /* F2（用户口径）：^ 菜单里「分割过渡…」「吸附网格…」等项支持**长按打开另一个菜单**。',
        '       长按门槛与其它手势一致（260ms + 震动）；长按成立时**吃掉**随后那次 onClick，',
        '       否则松手会顺手把开关翻掉。 */',
        '    const longPressTimerRef = React.useRef<number | null>(null);',
        '    const longPressFiredRef = React.useRef<string | null>(null);',
        '    const [longPressItem, setLongPressItem] = React.useState<FoldItem | null>(null);',
    );
    console.log('refs/state 已插入');
}

// ② 渲染处：`onClick={item.act}` → 带长按语义的版本
const clickAt = lines.findIndex((l) => /^\s*onClick=\{item\.act\}\s*$/.test(l));
if (clickAt < 0) {
    console.log('⚠️ 未找到 onClick={item.act}');
} else {
    const indent = (lines[clickAt].match(/^\s*/) ?? [''])[0];
    const block = [
        `${indent}onClick={() => {`,
        `${indent}    if (longPressFiredRef.current === item.id) {`,
        `${indent}        longPressFiredRef.current = null;`,
        `${indent}        return;`,
        `${indent}    }`,
        `${indent}    item.act();`,
        `${indent}}}`,
        `${indent}onPointerDown={() => {`,
        `${indent}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${indent}    longPressTimerRef.current = window.setTimeout(() => {`,
        `${indent}        longPressTimerRef.current = null;`,
        `${indent}        longPressFiredRef.current = item.id;`,
        `${indent}        try {`,
        `${indent}            (navigator as unknown as { vibrate?: (p: number) => boolean }).vibrate?.(12);`,
        `${indent}        } catch {`,
        `${indent}            /* 忽略 */`,
        `${indent}        }`,
        `${indent}        if (item.longPress) item.longPress();`,
        `${indent}        else setLongPressItem(item);`,
        `${indent}    }, 260);`,
        `${indent}}}`,
        `${indent}onPointerUp={() => {`,
        `${indent}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${indent}    longPressTimerRef.current = null;`,
        `${indent}}}`,
        `${indent}onPointerCancel={() => {`,
        `${indent}    window.clearTimeout(longPressTimerRef.current ?? undefined);`,
        `${indent}    longPressTimerRef.current = null;`,
        `${indent}}}`,
    ];
    lines.splice(clickAt, 1, ...block);
    console.log('长按处理已插入');
}
writeFileSync(path, lines.join('\n'), 'utf8');
console.log('完成');
