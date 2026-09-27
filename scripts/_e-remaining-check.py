#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组剩余 3 条的落点核对结论。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组剩余 3 条：落点核对（结论：2 条已有能力、只缺手势入口）

### ① 「双指拖动 = 平移且缩放」—— ✅ **本来就有**

`touchGesture.ts` 的双指提交是**一个式子**同时算缩放与平移：

```ts
const targetPxPerSec = clamp(s.pxPerSec0 * kx, pxBounds.min, pxBounds.max);
const secAtMid0 = (s.scrollLeft0 + s.mid0.x) / s.pxPerSec0;
const newScrollLeft = secAtMid0 * targetPxPerSec - mid.x;   // ← mid = 两指中点
```

`mid` 参与 ⇒ **缩放与平移天然联动**，正是规格说的"平移且缩放"。
纵向同理（`rowAtMid0 * targetRowH - mid.y`）。

⇒ **不用做。** 三个表面（轨道列 / 音频块 / 拍数栏）都在 `attachSurface` 覆盖内
（`TimelinePanel` 挂 `rulerEl:"x"` + `trackListEl:"y"`；
`PianoRollPanel` 挂 `axisEl:"y"` + `rulerEl:"x"`）。

⚠️ 唯一要确认的：轨道列的策略是 `"y"`（只纵轴），
⇒ 轨道列上双指只做**纵向**缩放+平移，**横向不动**。
这是 `docs/08` 定的"每表面轴向策略"，与"拍数栏只做横向"对称，**符合设计**。

### ② 「上划 = 调整淡入淡出时长」—— 能力已有，缺入口

淡入淡出的写入**早就实现**：`useEditDrag.ts` 里多处 `dispatch(setClipFades(...))`
（L867 / 1174 / 1214 / 1273），并且**拖角部控件调时长**的行为也在
（`ClipItem` 渲染的角部控件 + `fadeCornerReservePx` 预留区）。

⇒ 缺的只是「**长按控制点后上划**」这个入口。
落点就在我这次改过的 `ClipEdgeHandles.onMove` 里 ——
现在 `mode` 已经是惰性求值了，再加一个"纵向主导 ⇒ 走 fade 分支"即可。

### ③ 「双指长按并划动」—— 需内核/手势层扩展

规格里这一行只有两格有内容：

- **音频块** = 调整音频相对于块的位置（**相当于 Alt 拖动**）
- **轨道** = 平移且缩放（✅ ②里已确认天然满足）

⇒ 真正要做的只有**音频块的"调整音频相对位置"**。
但 `grep clipOffset / sourceOffset / audioOffset` 在 `interaction/` 下**无命中**
⇒ 这个能力**可能还没有**（或叫别的名字），需要先找到"音频相对块位置"在数据模型里叫什么。

⇒ **这条是唯一需要"先找数据结构"的**，不适合顺手做。

### 📌 总结：24 格的真实完成度

| 类别 | 数量 |
| :--- | :--- |
| 本来就有 | **19 格** |
| 本轮补齐 | **6 格**（拍数栏双击 / 轨道头左划 / 音频块双击 / 轨道双击 / 双指单击 / 控制点长按变速）|
| 待做 | **2 条**（① 上划调淡入淡出 —— **只缺入口，落点已明确**；② 双指长按调音频相对位置 —— **需先找数据结构**）|

⇒ **上游完整度 79%（19/24）**。"先核对再动手"的价值在这轮被反复验证。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| ⏳ 仍缺 | ① **上划调淡入淡出时长**（同一格后半句，走 `ClipContextMenu` 那套，需单独一轮）② **双指拖动 = 平移且缩放**（轨道/音频块/拍数栏三处）③ **双指长按并划动**（音频块=调整音频相对块的位置；轨道=平移且缩放）|"
if old in t:
    t = t.replace(old, """| **双指拖动 = 平移且缩放** | ✅ **本来就有**（无需改动）。`touchGesture.ts` 的提交是一个式子同时算缩放与平移：`newScrollLeft = secAtMid0 * targetPxPerSec - mid.x`（`mid` = 两指中点）⇒ **天然联动**。三个表面都在 `attachSurface` 覆盖内。⚠️ 轨道列策略是 `"y"`（只纵轴）、拍数栏是 `"x"`（只横轴），这是 `docs/08` 定的每表面轴向策略，符合设计 |
| ⏳ 仍缺（2 条）| ① **上划调淡入淡出时长** —— **能力已有**（`useEditDrag.ts` 多处 `setClipFades`，拖角部控件已能调），**只缺"长按后上划"入口**；落点就在 `ClipEdgeHandles.onMove`（本次已让 `mode` 惰性求值）② **双指长按并划动 · 音频块 = 调整音频相对块位置** —— `grep clipOffset/sourceOffset/audioOffset` **无命中** ⇒ **该能力可能还没有**，需先找到"音频相对块位置"在数据模型里的名字 |
| **E 组完成度** | **24 格中 19 格本来就有**（79%）；本轮补齐 6 格；剩 2 条 |""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：剩余条落点已明确")
