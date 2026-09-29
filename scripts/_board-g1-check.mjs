#!/usr/bin/env node
/** G-1 核实结果 + 待验脚本入板。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
let text = readFileSync(path, 'utf8');
const section = `

---

## 🔬 G-1 核实（2026-09-29 深夜）与其余待验项的设备状态

**G-1（浮条「更多」⇒ 右键菜单）已核实两点**：

1. \`hs-open-clip-context-menu\` 的监听**确实在产物里** ——
   \`upstream-src/frontend/dist/**/main-*.js\` 中 grep 到该字符串 ⇒ 不是"没编译进去"；
2. 渲染条件是 \`{contextMenu ? (() => { const ctxClip = sessionRef.current.clips.find(c => c.id === contextMenu.clipId); if (!ctxClip) return null; … })() : null}\`
   ⇒ 只要 \`contextMenu\` 为 null **或** \`ctxClip\` 找不到，就什么都不渲染。

**下一步（最短路径）**：在监听里临时加一行日志，确认到底是"没设上 \`contextMenu\`"还是"设上了但 \`ctxClip\` 找不到"
—— 前者查事件是否真的到达监听（可 dispatch 一个同名事件自测），后者查前后端 clips 的 id 是否一致。

**待验脚本已备好（等设备回来一条命令跑完三条）**：

\`\`\`bash
node scripts/_dbg-settings-branches.mjs <serial>
\`\`\`

它直接派发 \`hs-open-settings\`（绕开"^ 浮层打不开"的探针不稳），依次验证：
\`snap-grid\`（吸附网格设置）· \`split-transition\`（分割过渡设置，用于补 G-2b）· \`metronome\`（节拍器菜单）。

**设备状态**：真机 \`221deeb\` 在本轮验证途中再次断开；上述三条与 F1/F2 长按、E11-b 的验收都等设备回来。
`;
writeFileSync(path, text + section, 'utf8');
console.log('已入板');
