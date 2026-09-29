#!/usr/bin/env node
/** G 组入板。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
let text = readFileSync(path, 'utf8');
const section = `

---

# 📋 G 组：用户新批次（2026-09-29 深夜追加）

| # | 用户原话（要点）| 处理 | 状态 |
| :--- | :--- | :--- | :--- |
| G-1 | 临时菜单-省略号 点击后展开**右键那套菜单**（而不是另一个小菜单）| ✅ 实现：浮条「更多」派发 \`hs-open-clip-context-menu\`（**事件里带 \`clipId\`** —— 后端 \`select_clip\` 不更新前端 store，之前正是这个原因导致"发了事件没反应"），由 \`TimelinePanel\` 里已装配好的 \`ClipContextMenu\` 实例渲染 | 🔴 **仍未验成**：面板已挂载、块已选中、事件已派发，但 DOM 无变化（div 97→97）、console 无报错 ⇒ 下一步查：① 那个 effect 是否真被编译进产物；② \`contextMenu\` 的渲染分支条件（需要 \`ctxClip\` 等派生值）|
| G-2 | **吸附网格与分割过渡**的长按后界面对应原版软件的**吸附网格设置**与**分割过渡设置**，不是工程设置；**不要所有按钮长按都进工程设置** | ✅ **两项修正都已落地**：① 两项各自带 \`longPress\`，分别派发 \`which:"snap-grid"\` / \`"split-transition"\`，打开项目**已有**的 \`SnapGridSettingsDialog\` / \`SplitTransitionSettingsDialog\`；② 长按处理里**删掉**"没给 longPress 就打开工程设置"的兜底 ⇒ 无 longPress 的项长按**无反应** | ✅ G-2a（长按吸附网格 ⇒ 原版「吸附/网格设置...」，实测内容含网格线/间距/最小像素间距/Swing/吸附总开关）· ✅ G-2c（长按节拍器**不**打开工程设置）· 🟡 G-2b（长按分割过渡）待确认 —— 探针里前一个对话框的关闭不稳（radix backdrop 无我们的 data-* 属性），已改用 Escape，需再跑一次 |
| G-3 | **工程设置完全参考原软件的上工具栏设计**，不要自己猜选项是什么、是否有输入框，还缺 **BPM** | ✅ 按此重做：**加 BPM**（\`set_transport({bpm})\`，−1/+1/输入/保存）；**删掉我自己猜的"网格手动输入框"** —— 网格间距在原版属于「吸附网格设置」，这里只给一个"吸附/网格设置…"入口按钮；保留上工具栏里确实有的：基准音阶（按钮组）、拍号（分子/分母）、撤销历史（只读展示）| 🟡 已实现待验 |
| G-4 | **「节拍器」更名「节拍器…」**，因为它也有长按菜单 | ✅ 已改名（实测文案为「节拍器…」）| ✅ DONE（文案已确认）|

> 说明：G-2 的"原版设置"来自项目**已有**的对话框组件（不是我新造的），它们的项与原软件一致（吸附网格设置里可见：网格线/网格间距/最小像素间距/Swing 网格/摇摆程度/吸附总开关/吸附距离/吸附对象…）。
`;
writeFileSync(path, text + section, 'utf8');
console.log('G 组已入板');
