#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第 7 条：上划 = 调整淡入淡出时长。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 7 条：长按控制点后「**上划 = 调整淡入/淡出时长**」

### 关键发现：`fade_in` / `fade_out` 本来就是 `EditDragType`

`useEditDrag.ts:173` 的类型定义：

```ts
export type EditDragType =
    | "trim_left" | "trim_right"
    | "stretch_left" | "stretch_right"
    | "fade_in" | "fade_out"          // ← 本来就有
    | "gain" | "crossfade_edges" ...
```

⇒ 淡入淡出**与 trim/stretch 走同一个 `startEditDrag` 入口**，不用新写实现。

**唯一障碍**：`ClipEdgeHandles` 的 prop 把它**人为收窄**了：

```ts
type: "trim_left" | "trim_right" | "stretch_left" | "stretch_right",   // ← 缺 fade_*
```

⇒ 加宽即可（tsc 就是在这里报的错，一行修好）。

### 最终实现：一个函数收三种情形

```ts
const resolveEdgeDragType = (dx: number, dy: number) => {
    if (!edgeLongPressed) {
        return stretchActive ? "stretch_left" : "trim_left";   // 原行为
    }
    // 长按后按**主导方向**分流（规格：上划调淡入淡出、横滑调变速）
    return Math.abs(dy) > Math.abs(dx) ? "fade_in" : "stretch_left";
};
```

（右边缘对称：`fade_out` / `stretch_right`。）

⇒ 现在音频块左/右边缘是：

| 操作 | 结果 |
| :--- | :--- |
| 直接拖 | 裁短 / 延长（`trim_*`）|
| Alt + 拖 | 变速（`stretch_*`）|
| **长按 + 横滑** | **变速**（`stretch_*`，触屏等价 Alt）|
| **长按 + 上划（纵向主导）** | **调淡入/淡出时长**（`fade_*`）|

### ✅ tsc / 构建通过，**未运行时验证**

边缘手势要在真实音频块上操作才走得到，模拟器里没有素材 ⇒ **待真机（有音频）手测**。

### 📌 手法小结：这类"已有能力缺入口"的活怎么找

1. `grep` **能力名**（`fade`、`stretch`、`offset`）看实现**在不在**；
2. 若在，再 `grep` **调用点**看入口是什么（键鼠？Alt？菜单？）；
3. 缺的通常只是"把入口扩到触屏手势"——**改类型 + 加分支**，几行的事。

⚠️ 反过来，如果 `grep` **没命中**（如这次的 `clipOffset` / `sourceOffset`），
那说明**能力本身没实现**，得先定数据结构 —— 工作量完全不是一个量级。
**动手前先跑一次 `grep`，10 秒能省几小时。**
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| ⏳ 仍缺（2 条）| ① **上划调淡入淡出时长** —— **能力已有**（`useEditDrag.ts` 多处 `setClipFades`，拖角部控件已能调），**只缺\"长按后上划\"入口**；落点就在 `ClipEdgeHandles.onMove`（本次已让 `mode` 惰性求值）② **双指长按并划动 · 音频块 = 调整音频相对块位置** —— `grep clipOffset/sourceOffset/audioOffset` **无命中** ⇒ **该能力可能还没有**，需先找到\"音频相对块位置\"在数据模型里的名字 |"
if old in t:
    t = t.replace(old, """| **长按控制点 + 上划 = 调整淡入/淡出时长** | ✅ **代码完成**（tsc/构建通过）。🔑 关键：**`fade_in`/`fade_out` 本来就是 `EditDragType`**（`useEditDrag.ts:173`），与 trim/stretch **同一个 `startEditDrag` 入口** —— 唯一障碍是 `ClipEdgeHandles` 的 prop **人为收窄**了，加宽类型即可。实现收成一个 `resolveEdgeDragType(dx, dy)`：未长按⇒`trim_*` / 长按+纵向主导⇒`fade_*` / 长按+横向主导⇒`stretch_*`。**待真机（有音频）手测** |
| ⏳ 仍缺（1 条）| **双指长按并划动 · 音频块 = 调整音频相对块位置** —— `grep clipOffset/sourceOffset/audioOffset` **无命中** ⇒ **该能力本身可能没实现**，需先定数据结构（与"已有能力缺入口"不是一个量级）|""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组 7 条完成")
