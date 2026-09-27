#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第 6 条：音频块头尾控制点 · 长按 ⇒ 变速模式。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 6 条：音频块头尾控制点 · **长按 ⇒ 变速缩放模式**

### 现状：trim/stretch 的切换**早就存在**，但入口是**物理 Alt**

`ClipEdgeHandles.tsx`（左右两个边缘控制点，L74 / L170）：

```ts
const stretchActive = altPressed;
const mode = stretchActive ? "stretch_left" : "trim_left";   // 闭包常量
...
startEditDrag(..., clipId, mode);
```

⇒ **触屏上没有 Alt** ⇒ 手机上永远只能 `trim`（裁短/延长），拿不到 `stretch`（变速）。

### 改法（左右对称，共 4 处）

1. `onPointerDown` 起 500ms 定时器 ⇒ 到点 `edgeLongPressed = true`
   并给宿主打 `data-hs-edge-long-press="1"`（供 CSS 出提示）；
2. 🔑 **把 `mode` 的求值从 `onPointerDown` 移到 `onMove`** ——
   原本是**闭包常量**，长按后才决定就晚了；改成 `resolveEdgeMode()` 惰性求值；
3. `onEnd`（抬手/取消）清定时器。

⇒ 长按后拖动 = `stretch_*`，与物理 Alt **完全同一条** `startEditDrag` 路径，不新增分支。

### 视觉提示（第一版）

规格说「长按 ⇒ 上方出现淡入/淡出图标，**下方出现变速缩放图标**」。
图标待画，先用 CSS 顶上：长按后**边缘高亮 + 浮出「变速」字样**
（伪元素实现，不加子元素 —— 控制点是绝对定位细条，加子元素会改它的命中区）。

### ✅ 构建/类型检查通过，**未做运行时验证**

⚠️ 边缘手势要在真实音频块上长按才走得到，模拟器里没有素材。
**待真机（有音频）时手测**：长按块边缘 ⇒ 出现「变速」提示 ⇒ 拖动 ⇒ 应改变块速率而非时长。

⚠️ **上划调淡入淡出时长**（规格同一格的后半句）**尚未做** ——
它走的是另一套（`ClipContextMenu` 的淡入淡出），需单独一轮。

### 📌 手法：改"闭包常量"型的手势参数

这个 bug 模式值得记：**手势参数在 `pointerdown` 时一次算定、写进闭包** ⇒
任何"按下之后才成立的条件"（长按、双指、按住修饰键）都无效。
⇒ 遇到"某种按住后行为变体"，先检查参数是不是在 down 时求值的。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| 剩余待做 | ① 拍数栏长按变速（**需先扩内核接口**）② 上述 3 条待运行时验证 |"
if old in t:
    t = t.replace(old, """| **音频块头尾控制点 · 长按 ⇒ 变速缩放** | ✅ **代码完成**（tsc/构建通过）。现状：`trim`/`stretch` 切换**早已存在**，但入口是**物理 Alt** ⇒ 触屏拿不到。改法（左右对称 4 处）：① 按下起 500ms 定时器 ⇒ 标记长按；② 🔑 **`mode` 从「闭包常量」改为 `onMove` 里惰性求值**；③ `onEnd` 清定时器。⇒ 长按后拖动走 `stretch_*`，与 Alt 同一条 `startEditDrag` 路径。视觉提示先用「边缘高亮 + 变速字样」（伪元素）。**待真机（有音频）手测** |
| ⏳ 仍缺 | ① **上划调淡入淡出时长**（同一格后半句，走 `ClipContextMenu` 那套，需单独一轮）② **双指拖动 = 平移且缩放**（轨道/音频块/拍数栏三处）③ **双指长按并划动**（音频块=调整音频相对块的位置；轨道=平移且缩放）|""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组 6 条完成 + 明确剩余")
