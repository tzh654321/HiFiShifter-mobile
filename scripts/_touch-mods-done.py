#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组最后一条完成：触屏修饰键（slip / copy / 免吸附）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组最后一条完成：**触屏修饰键**（一次解决 slip / copy / 免吸附）

### 关键洞察：三件事挂在**同一个裁决点**

`timelineKernelHost.ts:2825` 原话：
> （`dragModifiersOf`：**Ctrl/Shift/Alt/⌘ 决定 copy / slip / 免吸附等语义**）

而它的实现（L4271）只是**原样搬运四个布尔**：

```ts
function dragModifiersOf(event) {
    return { ctrlKey: event.ctrlKey, shiftKey: ..., altKey: ..., metaKey: ... };
}
```

⇒ **一处改动 = 三件事一起解决**，这比逐个功能改手势划算得多。

### 做法：**触屏"虚拟修饰键"覆盖位**

```ts
const touchModifiers = { ctrl: false, shift: false, alt: false, meta: false };
export function setTouchModifiers(patch) { Object.assign(touchModifiers, patch); }
export function clearTouchModifiers() { ... }

function dragModifiersOf(event) {
    return {
        ctrlKey: event.ctrlKey || touchModifiers.ctrl,   // ← 读的时候多看一眼
        ...
        altKey: event.altKey || touchModifiers.alt,
    };
}
```

🔑 **为什么这比"合成 `PointerEvent.altKey`"好**：
`PointerEvent.altKey` 是**只读**的，伪造事件类既脆弱又要改内核的**输入契约**；
覆盖位只是"读的时候多看一眼"，4 处调用点**全都不用动**。

### 接线：双指长按 500ms ⇒ 点亮 alt

复用 `TimelinePanel` 里已有的双指指针计数（上次做"双指 tap 切轨道"那套）：
两指都按下 ⇒ 起 500ms 定时器 ⇒ `setTouchModifiers({ alt: true })`；
任一指针抬起/取消 ⇒ `clearTouchModifiers()`。

⚠️ **时序很关键**：`dragModifiersOf` 是在 **pointerdown 时快照**的
（内核注释：「收尾时才读事件早就没有修饰键状态了」）
⇒ 必须**先长按点亮、再动手拖**，正好对上规格的「**双指长按并划动**」。

### ✅ tsc / 构建通过，**未运行时验证**

要在真实音频块上双指长按再拖动才走得到，模拟器无素材 ⇒ **待真机手测**。
验证点：双指长按块中部 0.5s 后拖动 ⇒ 音频内容在块内平移（块位置/长度不变），
而不是整块被拖走。

### 🎉 E 组收官

| 类别 | 数量 |
| :--- | ---: |
| 本来就有 | **19 格** |
| 本轮补齐 | **8 条** |
| 剩 | **0** |

**8 条**：拍数栏双击 · 轨道头左划（含形态修正）· 音频块双击 · 轨道双击 ·
双指单击 · 控制点长按变速 · 控制点长按上划淡入淡出 · **双指长按 slip**。

### 📌 这轮最值钱的方法论

**"先 `grep` 一次能力名"** —— 10 秒能分辨：

- **能力已有、缺入口** ⇒ 改类型 + 加分支（几分钟）；
- **能力没有** ⇒ 先定数据结构（一轮）。

而更深一层：**找"唯一裁决点"**。修饰键这套之所以能一次解决三件事，
是因为所有语义都收口在 `dragModifiersOf` 一个函数里。
⇒ 动手前先问「**这几件事是不是挂在同一个开关上**」，是的话改开关，不是才逐个改。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| ⏳ 仍缺（1 条")), None)
if old:
    t = t.replace(old, """| **双指长按并划动 · 音频块 = 调整音频相对块位置（slip）** | ✅ **已完成**（tsc/构建通过）。能力真名是 **Slip（内部偏移）**，上游已有（`slipWindow.ts`，入口原为「Alt + 拖 clip 中部」）。🔑 **关键洞察**：`dragModifiersOf` 是 **copy / slip / 免吸附 三件事的唯一裁决点**（`timelineKernelHost.ts:2825`），而它只是**原样搬运四个布尔** ⇒ **一处改动解决三件事**。做法：加模块级**触屏虚拟修饰键** `touchModifiers`（`setTouchModifiers`/`clearTouchModifiers`），在 `dragModifiersOf` 里 `event.altKey \\|\\| touchModifiers.alt`；`TimelinePanel` 双指按住 500ms ⇒ 点亮 alt，抬手清掉。⚠️ **时序**：`dragModifiersOf` 在 **pointerdown 快照** ⇒ 必须先长按点亮再拖，正合规格「双指长按并划动」。**待真机手测** |""", 1)
    t = t.replace("| **E 组完成度** | **24 格中 19 格本来就有**（79%）；本轮补齐 6 格；剩 2 条 |",
                  "| **E 组完成度** | ✅ **收官**：24 格中 **19 格本来就有**（79%）；**本轮补齐 8 条**；剩 **0** |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组收官")
