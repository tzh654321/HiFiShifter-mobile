#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组最后一条核对：双指长按并划动 · 音频块 = 调整音频相对块位置。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组最后一条核对：Slip（内部偏移）—— **能力已有，入口是 Alt**

### 找到了它的真名

「调整音频相对于块的位置」在音频编辑里叫 **Slip（内部偏移）**，
上游**完整实现**了，而且文件第一行就写明：

`timeline/hooks/slipWindow.ts:2`
> slipWindow.ts — **Slip（内部偏移）拖拽的源窗口平移几何**。

同文件 L9 进一步说明入口：
> 这段逻辑原先只存在于旧实现的 `useSlipDrag` 内。渲染内核的「**Alt + 拖 clip 中部**」…

⇒ **入口 = Alt + 拖音频块中部**。

### 判定点只有一个

`timelineKernelHost.ts:2825`
> （`dragModifiersOf`：**Ctrl/Shift/Alt/⌘ 决定 copy / slip / 免吸附等语义**）

⇒ slip / copy / 免吸附**全由 `dragModifiersOf` 按修饰键分派**，
是整套拖拽语义的**唯一裁决点**。

### 🕳️ 为什么这条不能"顺手做"

`sweep`/`Alt` 这类语义走的是 **`PointerEvent` 的修饰键字段**（`altKey` 等），
而触屏手势**没有修饰键**。要让"双指长按"表达 Alt，有两条路，**都要动接口**：

1. **在事件里合成 `altKey`** —— 但 `PointerEvent.altKey` 是只读的，
   得在 `dragModifiersOf` 的入参上做一层包装（要改内核的输入契约）；
2. **给内核加一个"强制 slip"标志** —— 要在 `TimelineKernelHost` 上开方法，
   再由手势层调用（要扩接口）。

⇒ 无论哪条，都**不是"改类型 + 加分支"**那种几行的活 ——
这与前面 7 条的性质**根本不同**（前 7 条都是"已有入口，扩宽即可"）。

**⇒ 结论：这条留作独立一轮，先定"触屏如何表达修饰键语义"这个通用问题。**
它不只影响 slip —— `copy`（Ctrl 拖）与「免吸附」也都挂在同一处，
**一次设计能一起解决三件事**。

### 📌 顺带：规格表原始文件

用户提到那张截图来自 **`临时.xlsx`**（本地文件），
但 `find /c/Users/tzh -maxdepth 3 -iname "临时*.xlsx"` **未命中** ——
可能在更深的目录或别的盘。**下次需要时请直接给路径**，
读原始表格比读截图可靠（本轮就因为读图串列而误判过一次）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| ⏳ 仍缺（1 条）| **双指长按并划动 · 音频块 = 调整音频相对块位置** —— `grep clipOffset/sourceOffset/audioOffset` **无命中** ⇒ **该能力本身可能没实现**，需先定数据结构（与\"已有能力缺入口\"不是一个量级）|"
if old in t:
    t = t.replace(old, """| ⏳ 仍缺（1 条，**需接口扩展**）| **双指长按并划动 · 音频块 = 调整音频相对块位置**。核对更正：能力**已有**，叫 **Slip（内部偏移）**（`slipWindow.ts`，注释明写入口是「**Alt + 拖 clip 中部**」）；判定点唯一 —— `timelineKernelHost.ts:2825` 的 **`dragModifiersOf`**（Ctrl/Shift/Alt/⌘ 决定 copy / slip / 免吸附）。🕳️ **难点**：这些语义走 `PointerEvent` 的**修饰键字段**，触屏没有；要表达要么改内核输入契约、要么给内核加"强制 slip"标志 ⇒ **不是几行的活**。🔑 **建议**：独立一轮先定「**触屏如何表达修饰键语义**」—— 一次设计可同时解决 **slip + copy（Ctrl 拖）+ 免吸附** 三件事 |""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：最后一条已定性")
