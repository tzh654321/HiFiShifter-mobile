#!/usr/bin/env node
/**
 * E8（用户口径）：「带参数页面的分屏模式下：**上工具栏显示在参数界面上面**，
 * 且**可上下拖动调整分屏高度**；让**参数界面的拍数栏不能用于调整分屏高度**」。
 *
 * 实施：
 *   ① 给 `MobileParamToolRow` 的根元素（`hs-param-toolrow` / `role="toolbar"`）加
 *      `data-hs-split-handle="param-toolbar"` ⇒ 它成为手机端分屏手柄；
 *   ② `HANDLE_SELECTOR` 里**去掉** `[data-hs-time-ruler="params"]` ⇒ 参数拍数栏不再能拖分屏。
 *
 * 注：文件浏览器 / 记事本标题栏的 `data-hs-split-handle` 保留（那是它们的正常入口）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ① 上工具栏成为手柄
const mb = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let m = readFileSync(mb, 'utf8');
if (!m.includes('data-hs-split-handle="param-toolbar"')) {
    const old = `        <div
            /* D1：加语义类，供 CSS 收紧按钮间距（不改命中区） */
            className="hs-param-toolrow shrink-0 relative flex items-center bg-qt-base border-b border-qt-bord`;
    // 注释是中文且文件里可能是乱码 ⇒ 用更稳的锚点：className 那一行
    const idx = m.indexOf('className="hs-param-toolrow');
    if (idx > 0) {
        // 在该 div 起始标签内（className 之前）插入属性
        const divStart = m.lastIndexOf('<div', idx);
        if (divStart > 0) {
            m = m.slice(0, divStart + 4) + '\n            /* E8（用户口径）：**参数界面上的「上工具栏」就是手机端分屏的手柄** —— 可直接上下拖动调分屏高度。 */\n            data-hs-split-handle="param-toolbar"' + m.slice(divStart + 4);
            writeFileSync(mb, m, 'utf8');
            console.log('MobileParamToolRow: 已加 data-hs-split-handle="param-toolbar"');
        }
    } else {
        console.log('⚠️ 未找到 hs-param-toolrow 锚点');
    }
} else {
    console.log('MobileParamToolRow: 已有手柄属性');
}

// ② 参数拍数栏退出 HANDLE_SELECTOR
const app = 'upstream-src/frontend/src/App.tsx';
let a = readFileSync(app, 'utf8');
const oldSel = `const HANDLE_SELECTOR = '[data-hs-split-handle], [data-hs-time-ruler="params"]';`;
const newSel = `/* E8（用户口径）：手柄**只**认带 \`data-hs-split-handle\` 的那几条（上工具栏 / 文件浏览器标题栏 /
   记事本标题栏）。**参数界面的拍数栏不再参与** —— 它原先被塞进这个选择器，导致"拖拍数栏改分屏高度"。 */
const HANDLE_SELECTOR = '[data-hs-split-handle]';`;
if (a.includes(oldSel)) {
    a = a.replace(oldSel, newSel);
    writeFileSync(app, a, 'utf8');
    console.log('App.tsx: HANDLE_SELECTOR 已移除 params 拍数栏');
} else {
    console.log('⚠️ HANDLE_SELECTOR 锚点未命中');
}
