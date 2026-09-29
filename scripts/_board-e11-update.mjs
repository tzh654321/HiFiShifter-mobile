#!/usr/bin/env node
/** E11 行更新（记录最新诊断层）+ 收尾。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
const lines = readFileSync(path, 'utf8').split('\n');
const i = lines.findIndex((l) => l.startsWith('| E11 | '));
if (i >= 0) {
    lines[i] =
        '| E11 | **轨道头增益划不动了**；为防误触可设为**长按后划动** | 🟡 **部分完成**：① 防误触已生效（不等长按直接划动 ⇒ `volume` 1→1 ✅）；② 长按后拖动**仍未通**。已逐层排查并留证（工具 `_dbg-gain-trace.mjs` 逐帧采样 + 事件序列）：<br>· ① `startVolumeKnobDragNow` 开头对 touch/pen 直接 return（"触摸不拖增益旋钮"）—— 已改为长按后放行；<br>· ② 门槛阶段 `preventDefault()` 太晚 ⇒ 已加非被动 `touchmove` 阻止；<br>· ③ 改用**原生 touch 事件驱动**拖动；<br>· ④ 实测事件序列 `pointerdown → pointermove×2 → **pointercancel** → touchmove×6`，且合成触摸的 `pointercancel` **不带 `pointerType`** ⇒ 原来的 `ev.pointerType === "touch"` 判断挡不住、拖动被提前收尾 ⇒ 已改为 **`pointercancel` 一律不收尾**（收尾只认 pointerup 与原生 touchend/touchcancel）。<br>改完仍 `volume` 不变 ⇒ 下一层怀疑：`registerDragAbort(finish)` 的全局 abort 在手势层开始时中止了本拖动，或 `onVolumeUiChange` 的 store 路径未生效（诊断命令已备好）| 🟡 ①② 待续 |';
}
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`E11 行=${i + 1}`);
