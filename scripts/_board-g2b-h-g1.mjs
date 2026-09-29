#!/usr/bin/env node
/** 本轮验证结果入板（G-2b ✅ / H ✅ / G-2a 探针残留 / G-1 下一步）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
let text = readFileSync(path, 'utf8');
const section = `

---

## 🔬 本轮真机验证（设备恢复后，2026-09-30）

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| **G-2b 分割过渡设置** | ✅ **通过** | 派发 \`which:"split-transition"\` 后打开的是**原版「分割过渡设置」**：*「分割后自动在分割处添加淡入淡出，或通过延伸重叠减少 click 声。类型 延伸重叠 / 单位 秒 / 过渡长度 / 淡化曲线 不修改淡化曲线 / 重叠交叉淡化 / 跟随自动交叉淡化」* |
| **H 节拍器菜单** | ✅ 复现通过 | 「节拍器 启用 未生效 音量 − 50% + 细分 跟随网格 仅每拍 仅小节首 音色 嗒声 木鱼 蜂鸣 强调重拍 已生效 关闭」 |
| G-2a 吸附网格设置 | ⚠️ 本次为**探针干扰** | 该轮打开的是工程设置 —— 因为**上一个对话框没被关掉**（radix 的关闭在探针里不稳）；**单独测时是 ✅**（见上一节实测内容：网格线/间距/最小像素间距/Swing/吸附总开关…）|
| G-1 事件桥 vs 真实右键 | ⚠️ **对照实验设计有误** | 我把 \`contextmenu\` 派发在**容器** \`[data-hs-surface="timeline"]\` 上，而内核监听的是**它自己的 canvas** ⇒ 这条"对照"无效，**不能**据此判断"手机端不支持右键菜单"。{{事件桥本身仍未唤起菜单}} |

### G-1 下一步（最短路径，一次构建即可定位）

在 `hs-open-clip-context-menu` 的监听里临时加两行日志：

\`\`\`ts
console.log("[g1] event", d.clipId, session.selectedClipId, session.clips.length);
console.log("[g1] ctxClip found", session.clips.some(c => c.id === (d.clipId ?? session.selectedClipId)));
\`\`\`

再跑一次派发，看是**事件没到**（第一行不打印）、**id 对不上**（第二行 false）、还是**到了也对上了却不渲染**
（那就要看 `resolveQuickExportClipIds` 等后续派生值有没有抛错）。

### 正确验证"右键路径"的方式（供下一次）

右键菜单由**内核的指针回调**触发（不是 DOM 冒泡）⇒ 要在**内核 canvas**（\`[data-hs-timeline-kernel="1"]\` 内的 canvas）
上派发 \`contextmenu\` / 或直接用 CDP 的 \`Input.dispatchMouseEvent\`（\`button: "right"\`）打在**块所在坐标**上。
`;
writeFileSync(path, text + section, 'utf8');
console.log('已入板');
