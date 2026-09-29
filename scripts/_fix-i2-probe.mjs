#!/usr/bin/env node
/** 把 I-2 探针改成：打开文件面板 + 用文件浏览器标题栏当手柄（正是 I-3 报的位置）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'scripts/_probe-i2-split-drag.mjs';
let t = readFileSync(p, 'utf8');

// ① 候选顺序：文件/记事本标题栏优先
t = t.replace(
    "const cands = [...document.querySelectorAll('[data-hs-time-ruler=\"params\"],[data-hs-split-handle]')]",
    "const cands = [...document.querySelectorAll('[data-hs-split-handle=\"files\"],[data-hs-split-handle=\"notes\"],[data-hs-time-ruler=\"params\"],[data-hs-split-handle]')]",
);

// ② 找手柄之前先打开文件面板
const anchor = "st = await splitChildren();\nconsole.log('分屏后：' + JSON.stringify(st));";
if (t.includes(anchor) && !t.includes('加文件面板后')) {
    t = t.replace(
        anchor,
        `${anchor}
/* I-3 用户报的正是「参数+文件分屏时拖文件标题栏」⇒ 把文件面板也打开再测。 */
await menu('视图');
await pick('文件浏览器');
st = await splitChildren();
console.log('加文件面板后：' + JSON.stringify(st));`,
    );
}

writeFileSync(p, t, 'utf8');
console.log(`候选已改=${t.includes('data-hs-split-handle=\\"files\\"')}  打开文件面板=${t.includes('加文件面板后')}`);
