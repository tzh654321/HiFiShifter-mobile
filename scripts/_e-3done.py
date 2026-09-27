#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第 3 条：双击音频块 = 展开编辑区。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 3 条：双击音频块 = 展开编辑区（手机）

### 核对下来的实情：桌面**早就做完了**

`handleKernelDoubleClickClip`（`TimelinePanel.tsx:4242`）已经在做：

```ts
window.dispatchEvent(new CustomEvent("hifi:editOp", {
    detail: { op: "selectClipParamRange", clipId, mode },
}));
```

⇒ 语义就是「**把这个块的时间范围送进参数编辑器**」= "展开全屏编辑"的实质。

**手机缺的只是一步**：参数面板默认**不显示**（C 组的分屏机制默认只勾「轨道面板」）
⇒ 双击之后选区更新了，**但用户看不到**（面板没开）。

⇒ 补一行：手机端双击块时 `dispatch(showMobilePanel("params"))`。

### 🕳️ 为什么不能在 DOM 上挂双击

**音频块是 canvas 绘制的**（不是 DOM 节点）——
`grep data-clip-id` 只命中 `FadeHitLayer.tsx`（那是淡入淡出的命中层，另一回事）。
⇒ 双击只能走内核回调 `handleKernelDoubleClickClip`，不能像拍数栏那样
`addEventListener("dblclick")`。

**判据**：**内核渲染的内容（音频块、波形、网格）都没有 DOM 节点**，
一切交互都得从内核回调进；只有外框、工具栏、拍数栏这些是真的 DOM。

### 音频块这一列核对结果

| 手势 | 行为 | 现状 |
| :--- | :--- | :--- |
| 单击 | 选中 + 显示常用操作与左右控制点 | ✅ 已有 |
| **双击** | **展开全屏编辑** | ✅ **本步补齐**（手机端自动开参数面板）|
| 划动 | 未选中=平移 / 已选中=拖动块 | ✅ 已有 |
| 长按 | 打开淡入淡出菜单 | ✅ 已有（长按上下文菜单，`0005` 补丁；`ClipContextMenu` 含淡入淡出）|
| 长按并划动 | 拖动块 | ✅ 已有 |

⇒ **音频块这一列也齐了**（与轨道头列一样，只补了一处）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| 其余条目（单击/划动/长按/长按并划动/双指单击 × 4 区域）| ⏳ 待逐条落地 |"
if old in t:
    t = t.replace(old, """| **双击音频块 = 展开全屏编辑** | ✅ **已完成**。核对发现**桌面早就做完**（`handleKernelDoubleClickClip` 派发 `selectClipParamRange` = 把块范围送进参数编辑器）；**手机只缺一步** —— 参数面板默认不显示（C 组分屏），双击后"选区变了却看不见" ⇒ 手机端顺手 `showMobilePanel("params")`。🕳️ 音频块是 **canvas 绘制**（无 DOM），双击只能走内核回调 |
| 轨道头 / 音频块 两列 | ✅ **已核对齐**（各只补了一处：轨道头左划隐藏、音频块双击展开）|
| 其余条目（轨道列 / 拍数栏的长按变速、双指单击）| ⏳ 待落地；拍数栏变速需先扩内核接口 |""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组 3/21")
