#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 A5 修正。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## ✅ A5：「选择 / 绘制」的角标交互统一（20:10-20:45）

交接里 A5 只写了一句「「选择」的切换方式向「绘制」统一」，方向含糊。
**实测把差异量出来了**（CDP 量 `data-hs-draw-corner` / `data-hs-select-corner`）：

```
drawCorner:   { w: 6,  h: 6  }     ← 绘制角标
selectCorner: { w: 14, h: 14 }     ← 选择角标
```

对照两边源码后，差异一共 **5 处**（`MobileBottomBar.tsx`）：

| | 绘制 `IconPencilWithCorner` | 选择 `IconCursorWithCorner` |
| :--- | :--- | :--- |
| 命中区 | **6×6**（手指点不中）| **14×14** |
| 定位 | `right/bottom: -1` | `-4` |
| opacity | **0.7** | **0.9** |
| 点角标开菜单 | **无**（只靠外层 400ms 长按）| **有**（`onClick` + 拦冒泡）|
| `cursor:pointer` | 无 | 有 |

### 统一方向：**绘制向选择看齐**（不是反过来）

判断依据：选择那套 **14×14 命中区是你自己明确要过的**
（`TASKS.md:174` 记「角标可点，含**命中区放大到 14×14**」）；
而绘制的 6px 三角**客观上点不中**。若照字面「选择向绘制统一」= 退回到 6px，不合理。

⇒ 改 `IconPencilWithCorner`：命中区 14×14（**图形仍只画 6×6**）、位置 -4、opacity 0.9、
加 `cursor:pointer`、**点角标直接开菜单**（新增 `onCornerClick` prop，调用点传 `openDrawMenu`
—— 与长按那条路走同一个函数，两条路并存）。

⚠️ **保留长按**：用户口径里长按一直是有效入口，只是**多**了一条"点角标"的路。

✅ `tsc` 0 错 · 补丁 regen + verify 通过（78 文件逐字节一致）。
🟡 待构建 + 装机 + 实测（量两个角标应都是 14×14）。
""", encoding="utf-8")
print("✓ memory 已追加")
