#!/usr/bin/env node
/**
 * F2 回退（只保留"改名加…"）：长按处理需要落在 `items.map` 所在组件的作用域，
 * 而 `trackFoldItems` 在另一个组件里 ⇒ refs 跨作用域，编译不过。
 * 本轮先把改名落地（可编译、可验证），长按支持留下一轮按正确作用域实现。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let lines = readFileSync(path, 'utf8').split('\n');

// ① 删掉插入的长按处理块：从 `onClick={() => {` + longPressFiredRef 起，到 onPointerCancel 结束
const start = lines.findIndex((l) => /longPressFiredRef\.current === item\.id/.test(l));
if (start >= 0) {
    // 往回找到这组属性的第一行 `onClick={() => {`
    let s = start;
    while (s > 0 && !/onClick=\{\(\) => \{/.test(lines[s])) s--;
    // 往后找到 onPointerCancel 块的结束 `}}`
    let e = start;
    while (e < lines.length && !/onPointerCancel=\{\(\) => \{/.test(lines[e])) e++;
    // 跳过该块（4 行：onPointerCancel / clearTimeout / = null / }}）
    let k = e;
    let braces = 0;
    for (; k < lines.length; k++) {
        if (/onPointerCancel=\{\(\) => \{/.test(lines[k])) braces = 1;
        else if (braces > 0 && /\}\}/.test(lines[k])) {
            braces = 0;
            break;
        }
    }
    const removed = k - s + 1;
    lines.splice(s, removed, '                        onClick={item.act}');
    console.log(`已回退长按处理（删除 ${removed} 行，恢复 onClick={item.act}）`);
} else {
    console.log('未找到长按处理块');
}

// ② 删掉插入的 refs/state 与注释
const removeLines = (pred) => {
    const kept = lines.filter((l) => !pred(l));
    const n = lines.length - kept.length;
    lines = kept;
    return n;
};
let n = 0;
n += removeLines((l) => /const longPressTimerRef = React\.useRef/.test(l));
n += removeLines((l) => /const longPressFiredRef = React\.useRef/.test(l));
n += removeLines((l) => /const \[longPressItem, setLongPressItem\]/.test(l));
n += removeLines((l) => /F2（用户口径）：\^ 菜单里/.test(l));
n += removeLines((l) => /长按门槛与其它手势一致（260ms \+ 震动）/.test(l));
n += removeLines((l) => /否则松手会顺手把开关翻掉/.test(l));
console.log(`已删除 refs/注释 ${n} 行`);

writeFileSync(path, lines.join('\n'), 'utf8');
const t = lines.join('\n');
console.log(`保留改名：${t.includes('mobile_grid")}…') && t.includes('mobile_auto_crossfade")}…')}`);
console.log(`FoldItem.longPress 接口：${t.includes('longPress?: () => void')}（保留，供下一轮实现）`);
