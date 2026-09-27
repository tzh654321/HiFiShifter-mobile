#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 D4 的进度写进 TASKS.md。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

old = "| D4 | 选择工具加三角 + 「拖动」工具（手套）| 新工具 + 手势语义 |"
assert old in t, "D4 行锚不唯一"
t = t.replace(old,
    "| **D4** | 选择工具加三角 + 「拖动」工具（手套）| 🟡 **UI 已完成，手势行为待接**。"
    "① `ToolModeGroup` / `ToolMode` 加 `\"drag\"`；`setToolMode` 里 drag **单独成组且不覆盖 `drawToolMode`**"
    "（切回绘制仍保留上次选的笔）；② 上游那批用 `toolMode !== \"select\"` 表达「绘制类」的地方会误放行 drag，"
    "⇒ 收口成 `isDrawToolMode()`，落笔分支已改；"
    "③ 光标 drag ⇒ `grab`；④ 「选择」按钮加右下角标（与铅笔同款 6×6 三角）+ 长按 400ms 菜单 "
    "`SelectToolMenu`（选择 / 拖动）+ 新画 `IconGlove` + CSS + i18n 中英。"
    "⏳ **待接**：「参数区单指平移」需接手势层（当前 drag 只是「不编辑」，还不能拖视野）|",
    1)
P.write_text(t, encoding="utf-8")
print("✓ TASKS.md：D4 进度已更新")
