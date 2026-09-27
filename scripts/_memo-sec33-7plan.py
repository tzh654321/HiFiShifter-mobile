#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #7 的探索结论与实现方案（本轮不做实现，先给判断）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉝ #7「直线/颤音滑动条」的探索结论：这不是小修，是一个完整功能

用户口径：「直线/颤音 功能画完一条直线后，在直线对应位置旁 显示一横一纵两个滑动条，
横条调整波长，纵条调整振幅，点击空白处（不包括拍数栏、钢琴栏、上下工具栏、菜单栏）确认以关闭滑动条」。

### 为什么手机上现在调不了

`pianoRoll/vibratoDragAdjust.ts` 里，颤音参数**只有两条调节通道**：

```ts
export type VibratoAdjustTarget = "amplitude" | "frequency";
```

- **键盘修饰键**（`vibratoDragAmplitudeIncrease` / `...FrequencyDecrease` 等，
  `usePianoRollInteractions.ts` 里解析 `resolveVibratoDragKeyboardAdjustment`）
- **滚轮**（`wheelGesture.ts`）

⇒ **手机上既没有修饰键也没有滚轮**，所以颤音画完之后**振幅/波长就定死了**。
用户要的滑动条正是补这条缺失的通道。

### 已摸清的关键结构

| 东西 | 位置 | 说明 |
| :--- | :--- | :--- |
| 颤音绘制状态 | `usePianoRollInteractions.ts:632` `vibratoStateRef` | 含 `amplitude` / `frequency` / `startFrame` / `currentFrame` 等 |
| 状态清空点（="画完"）| 同文件 `3869` / `4088` / `4104` / `4286` / `4323` 五处 | ⚠️ 五个出口，挂钩子要全考虑 |
| 绘制提交 | `commitStroke(points, mode)` 类型签名在 `239` | 手绘落盘的统一入口 |
| 绘制后处理 | `applyPostStrokeSmoothing` `880` | 单次高斯平滑（与本次需求无关，但会改刚画的点）|

### 实现方案（4 步，约 300~400 行）

1. **新增浮层组件** `VibratoAdjustOverlay.tsx`
   —— 一横一纵两个滑动条，锚在刚画的那条线的**中段位置旁**（用 frame → px 换算，复用
   `renderKernel` 的 viewport，保证缩放/滚动时跟着走）。

2. **记录"刚画完的那条线"** —— 在 `vibratoStateRef` 清空的那几个出口里，把
   `{startFrame, endFrame, amplitude, frequency, trackId, editParam}` 存进一个新 state。
   ⚠️ **五个出口都要挂**，漏一个就会出现"某些画法不弹滑条"。

3. **滑动条 → 改线** —— 需要一个"改某段颤音参数"的编辑操作。
   现有 `editOp` 通道（`hifi:editOp`）已经有 `addClipsToParamSelection` 这类先例，
   新增一个 `setVibratoParams` 是同一个套路；落到 Rust 侧改 `amplitude` / `frequency` 后重算该段曲线。

4. **点空白关闭** —— 在 `document` 上挂 `pointerdown` 捕获：
   命中 `拍数栏 / 钢琴栏 / 上下工具栏 / 菜单栏` 任一（**用已有的 `data-*` 标记或 class 判定**）就**不算"空白"**，
   其余区域点击即确认并收起。

### ⚠️ 为什么不在这轮硬做

- 它要动的是**参数编辑器的手绘主流程**（`usePianoRollInteractions.ts` 3000+ 行，
  是整个钢琴卷帘最核心的文件）。`vibratoStateRef` 有**五个清空出口**，
  挂钩子漏一个就会产生难查的边角 bug。
- 而第 3 步（滑动条→改线）需要新增一条跨 Rust 的编辑通道，
  等于把"UI 浮层"和"数据回写"两件事一起做。
- ⇒ **硬塞进一轮的风险，明显高于"先确认方案再动手"**。

**建议**：这一项单独开一轮，按上面 4 步走，每步都能单独验证
（浮层渲染 → 触发时机 → 参数回写 → 关闭逻辑）。
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉝ 节已追加（#7 方案）")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 7 |")), None)
if line:
    new = ("| 7 | 直线/颤音画完显示横纵两个滑动条（横=波长，纵=振幅），点空白确认关闭 | "
           "🔍 **已探明方案，建议单独开一轮**。现状：颤音参数**只有键盘修饰键 + 滚轮**两条通道"
           "（`vibratoDragAdjust.ts` 的 `VibratoAdjustTarget`），**手机两样都没有** ⇒ 画完就定死。"
           "已摸清：`vibratoStateRef`（含 amplitude/frequency，**五个清空出口**都要挂钩子）、"
           "`commitStroke` 落盘入口、`hifi:editOp` 自定义事件通道。"
           "**4 步**：① `VibratoAdjustOverlay` 浮层（锚在线的中段旁，走 renderKernel 换算）"
           "② 记录刚画完那条线（**五处出口都要挂**）③ 新增 `setVibratoParams` 编辑通道回写（跨 Rust）"
           "④ 点空白关闭（拍数栏/钢琴栏/工具栏/菜单栏要**判定为非空白**）。约 300~400 行，"
           "⚠️ 动的是手绘主流程（3000+ 行核心文件），硬塞一轮风险高 | A | TODO:待单独排期 |")
    t = t.replace(line, new, 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：#7 已写入方案与排期建议")
