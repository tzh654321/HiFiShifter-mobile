#!/usr/bin/env node
/** E12/E6 状态写回任务板（按行号替换，避免 PowerShell 引号问题）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
const lines = readFileSync(path, 'utf8').split('\n');

const findRow = (key) => lines.findIndex((l) => l.startsWith(`| ${key} | `));

const i12 = findRow('E12');
if (i12 >= 0) {
    lines[i12] =
        '| E12 | 长按并划动的操作都在识别到长按后**震动一下**（"已完成部分，设计得不错"）| ✅ 已补全：增益旋钮（本次新增）、**文件浏览器长按拖拽**（本次新增），与既有长按手势统一 `navigator.vibrate(12)`（失败静默：部分 WebView 无振动权限）| ✅ 已实现（震动本身无法用脚本断言，靠手感确认）|';
}
const i6 = findRow('E6');
if (i6 >= 0) {
    lines[i6] =
        '| E6 | 点击临时菜单中的选项后**也要隐藏菜单** | ✅ 已实现（`ClipQuickActions`：原来对浮条自身直接 return ⇒ 现改为命中可点项即收起）| 🔴 **仍未验成**：`selected_clip_id` 已置位但仍 `barPresent:false` ⇒ 浮条压根没渲染。已排除"块不可见"（改用块**可见区间中点**点击后仍不出现）⇒ 门控还有别的条件（`vp.containerRect` / `rowIndex` / `hiddenForClipId`）待逐个确认 |';
}
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`E12 行=${i12 + 1}  E6 行=${i6 + 1}`);
