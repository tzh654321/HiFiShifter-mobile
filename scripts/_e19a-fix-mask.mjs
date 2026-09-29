#!/usr/bin/env node
/**
 * E19a 真根因修复：「还原」模式下拖动要求 `buttons` 含**右键位（2）**，
 * 而触摸/左键是 **1** ⇒ 所有 pointermove 被丢弃 ⇒ 手机上"只能点一个点"。
 *
 * 修法：restore 模式下把必需位掩码放宽为 `1 | 2`（左键或右键都行）。
 *   · 手机：触摸给 1 ⇒ 现在能拖；
 *   · 电脑：右键给 2 ⇒ 语义不变；左键在还原模式也生效（这正是用户要的"还原画笔可用"）；
 *   · 笔杆橡皮端（PEN_ERASER_BUTTONS_MASK = 32）行为不变。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts';
let t = readFileSync(f, 'utf8');
const before = t;

const pairs = [
    [
        'const requiredButtonMask =\n                        mode === "restore" ? (penEraserDown ? PEN_ERASER_BUTTONS_MASK : 2) : 1;',
        '/* E19a 真根因修复：还原模式原先要求"右键位（2）"，而触摸/左键给的是 1 ⇒ 手机上所有\n                        pointermove 被丢弃（表现：按下有反应、拖动没反应 = "只能点一个点"）。\n                        放宽为 1|2：左键或右键都接受；电脑右键语义不变；笔杆橡皮端掩码不变。 */\n                        const requiredButtonMask =\n                        mode === "restore" ? (penEraserDown ? PEN_ERASER_BUTTONS_MASK : 1 | 2) : 1;',
    ],
    [
        'const requiredButtonMask =\n                    mode === "restore" ? (penEraserDown ? PEN_ERASER_BUTTONS_MASK : 2) : 1;',
        '/* E19a：同下 —— 还原模式放宽为左键或右键（触摸只有左键位）。 */\n                    const requiredButtonMask =\n                    mode === "restore" ? (penEraserDown ? PEN_ERASER_BUTTONS_MASK : 1 | 2) : 1;',
    ],
];

let n = 0;
for (const [from, to] of pairs) {
    if (t.includes(from)) {
        t = t.replace(from, to);
        n += 1;
    }
}
// 兜底：直接替换所有出现（缩进无关）
const re = /mode === "restore" \? \(penEraserDown \? PEN_ERASER_BUTTONS_MASK : 2\) : 1;/g;
const cnt = (t.match(re) ?? []).length;
t = t.replace(re, 'mode === "restore" ? (penEraserDown ? PEN_ERASER_BUTTONS_MASK : 1 | 2) : 1;');

writeFileSync(f, t, 'utf8');
console.log(`精确替换 ${n} 处；正则兜底替换 ${cnt} 处；总改动=${before !== t}`);
console.log(`校验：残留 ": 2) : 1;" = ${(t.match(/: 2\) : 1;/g) ?? []).length}（应为 0）`);
