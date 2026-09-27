#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按模拟器实测结果更新 TASKS.md（#14 找到根因并修好、#2/#3 已验证）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

# #14：找到 `››` 的根因
old14 = [l for l in t.splitlines() if l.startswith("| 14 |")]
if old14:
    t = t.replace(
        old14[0],
        "| 14 | 菜单去掉 `>` 符号 | ✅ **已修**：模拟器上实测菜单里是 **`››` 两个箭头** —— "
        "`MobileTopBar.tsx` 在**标签文字里手写了 `›`**（7 处：最近打开/导入外部工程/主题/语言/"
        "拉伸工程覆盖/拉伸全局默认 等），而 L768 右侧**又渲染了一个**。已删掉文字里那 7 处，"
        "保留右侧渲染的那个 | A | DONE:09-24 |",
        1,
    )

# #2 / #3：补验证结论
for tag, note in [
    ("| 2 |", "（模拟器实测通过：音符/三条谐振峰/气流/弹簧/喇叭/声像滑块 各不相同）"),
    ("| 3 |", "（模拟器实测通过：右侧只剩曲线显隐胶囊）"),
]:
    line = next((l for l in t.splitlines() if l.startswith(tag)), None)
    if line and "模拟器实测" not in line:
        t = t.replace(line, line.rstrip(" |") + " " + note + " |", 1)

P.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新（#14 完成含根因，#2/#3 补验证结论）")
