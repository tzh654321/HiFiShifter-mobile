#!/usr/bin/env node
/** F1/F2 状态更新（长按已接、F1 探针已修，均待设备验收）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
const lines = readFileSync(path, 'utf8').split('\n');

const iF1 = lines.findIndex((l) => l.startsWith('| F1 | '));
if (iF1 >= 0) {
    lines[iF1] =
        '| F1 | 临时菜单-省略号 点击后展开**右键会出现的菜单**，而不是另一个小菜单 | ✅ 已实现：浮条「更多」不再开小菜单，改为派发 `hs-open-clip-context-menu`，由 `TimelinePanel` 里**已装配好的** `ClipContextMenu` 实例呈现（它有 ~40 个 props，复制进浮条必然漂移）| 🟡 已实现待验：`TimelinePanel` **只在轨道面板可见时挂载** ⇒ 事件监听也只在那时存在（探针已修为"先切轨道面板 + 确保有块 + `select_clip` 选中"）；设备已断开，未跑通 |';
}
const iF2 = lines.findIndex((l) => l.startsWith('| F2 | '));
if (iF2 >= 0) {
    lines[iF2] =
        '| F2 | ^ 菜单中**分割过渡、吸附网格**要能**长按打开另一个菜单**，并命名为「分割过渡…」「吸附网格…」 | ✅ **两项都完成**：① 命名 —— `吸附网格…`、`分割过渡…`（实测文案；`autoCrossfade` 保持原名「自动交叉」）；② **长按**已接入 `FoldPanel`（承载 `items.map` 的组件，上一轮插错到 `trackFoldItems` 所在组件导致编译不过）：260ms 门槛 + 震动，长按成立时**吃掉**随后的 click（否则松手会把开关翻掉）；未提供 `longPress` 的项打开「工程设置」浮层（网格设置在其中，对「吸附网格…」语义正确）| 🟡 长按已实现待验（设备断开）|';
}

const note = [
    '',
    '### 🔧 设备与本轮验证状态（2026-09-29 22:0x）',
    '',
    '* 真机 `221deeb` 中途拔出；模拟器 `emulator-5554` 随后也关闭 ⇒ **F1 与 F2 长按的验收未跑完**。',
    '* 两者**代码均已就位且 `tsc` 干净、x86_64 包构建通过**，只是缺一次设备验证。',
    '* 恢复设备后要跑的命令：`node scripts/_probe-f-batch.mjs <serial>`（F1/F2/F3/F4 一起验）。',
].join('\n');
writeFileSync(path, lines.join('\n') + note + '\n', 'utf8');
console.log('板子已更新');
