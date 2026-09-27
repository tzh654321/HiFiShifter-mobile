#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㊹ 节：D4 完成（UI）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊹ D4 完成（UI 部分）：选择工具加角标 + 「拖动」工具

### 做法

1. **类型**：`ToolModeGroup` 加 `"drag"`；`ToolMode` 加 `"drag"`。
2. **`setToolMode`**：`drag` **单独成组**，且 **不覆盖 `drawToolMode`**
   （切回绘制时仍保留用户上次选的笔/颤音/还原）。
3. 🔴 **踩点：上游用 `toolMode !== "select"` 表达"绘制类"**，加入 `drag` 后会**误放行**
   ⇒ 收口成 `isDrawToolMode(mode) = mode !== "select" && mode !== "drag"`，
   落笔分支已改用它。**散落的同类判断以后也要走这个函数**，别再写裸比较。
4. **光标**：`drag` ⇒ `grab`。
5. **UI**：照抄铅笔那套（`IconPencilWithCorner` 的 6×6 角标 + 400ms 长按 + `fixed` 定位菜单），
   做了 `IconCursorWithCorner({ drag })`、`SelectToolMenu`（选择 / 拖动）、`IconGlove`、
   `.hs-select-tool-menu` 样式、i18n 中英 `mobile_tool_select` / `mobile_tool_drag`。

### ✅ 已验证

CDP 查 DOM：`[data-hs-select-corner]` 与 `[data-hs-select-anchor]` 都**存在**；
截图可见选择按钮右下角的小三角。

### ⏳ 待接（D4 的另一半）

**「参数区单指平移」还没接**。当前 `drag` 只做到"不编辑"（不放行落笔、不拉选区），
但**还不能拖视野**。需要把它接到手势/平移通道上。

⚠️ 这块风险高：`usePianoRollInteractions` 的单指拖已有绘制与选区两条语义，
再加"平移"要小心别破坏既有交互。建议**单独一轮做**，并配真机/模拟器实测。
"""
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊹ 节已追加")
