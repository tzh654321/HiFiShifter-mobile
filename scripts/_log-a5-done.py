#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 A5 完成。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## ✅ A5 完成：两处角标已统一（设备实测）

构建（C 盘腾出 4.4G 后 6m26s）→ 装机 → 打开参数面板后量：

```json
"drawCorner":   { "w": 14, "h": 14, "op": 0.9, "cursor": "pointer" }
"selectCorner": { "w": 14, "h": 14, "op": 0.9, "cursor": "pointer" }
```

⇒ **完全一致**（改前绘制是 `6×6 / 0.7 / 无 cursor`）。

### ⚠️ 「点角标开菜单」这一条**没能在模拟器上自动验**

`_eval.mjs` 里合成 `PointerEvent` + `MouseEvent('click')` **穿不到 React 的委托层**
（`onClick` 没触发，菜单没开）。这与交接里那条方法论一致但不完整 ——
那边写的是「React `onPointer*` 用**合成 `PointerEvent`** 最稳」，而**`onClick` 更靠后**，
需要完整的 pointerdown→pointerup→click 且**由真实浏览器输入产生**才可靠。
⇒ **结论**：交互类（点开菜单）**必须用 CDP `Input.dispatchTouchEvent` 或真机手测**，
用 DOM `dispatchEvent` 只能验「视觉/布局/属性」，不能验「React 事件是否接上」。

**待验（真机手测）**：点绘制按钮右下角三角 ⇒ 应弹出绘制工具子菜单（绘制/颤音/还原）。
（长按那条路本来就在，不受影响。）
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.replace(
    "| A5 | 「选择」的切换方式向「绘制」**统一** | TODO |",
    "| A5 | 「选择」的切换方式向「绘制」**统一** | ✅ DONE（2026-09-27 20:40）。实测两处角标完全一致：`14×14 / opacity 0.9 / cursor:pointer`（改前绘制是 `6×6 / 0.7 / 无 cursor`）。⚠️「点角标开菜单」需真实触摸/手测（DOM 合成事件穿不到 React 委托层）|",
    1,
)
t = t.rstrip() + """

### ✅ A5 完成（2026-09-27 20:40）—— 并修正一处**方向性判断**

交接写「「选择」的切换方式向「绘制」统一」，**字面照做会倒退**（绘制那边是 6×6 点不中）。
实测量出差异后按**绘制向选择看齐**做：

| | 改前 | 改后 |
| :--- | :--- | :--- |
| 命中区 | 6×6 | **14×14** |
| 定位 | -1 | **-4** |
| opacity | 0.7 | **0.9** |
| cursor | 无 | **pointer** |
| 点角标开菜单 | 无 | **有**（`onCornerClick` → `openDrawMenu`）|

依据：选择那套 14×14 是用户自己明确要过的（`TASKS.md:174`）。

**验证**：构建 x86_64 → 装机 → CDP 量两处角标 ⇒ **完全一致**。
🟡 「点角标开菜单」待真机手测（`_eval.mjs` 的 DOM 合成事件触发不了 React `onClick`）。

⚠️ **方法论补充**（写进探针纪律）：**DOM `dispatchEvent` 只能验"视觉/布局/属性"，
验不了"React 事件是否接上"** —— 交互类必须走 CDP `Input` 域或真机。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
