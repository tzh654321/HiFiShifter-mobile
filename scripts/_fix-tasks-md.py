#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 TASKS.md 中被 bash 反引号替换吞掉的内容，并确认 13/14/15 三行完好。

又踩了一次「`python -c "长文本含反引号"` 被 bash 当命令替换」——
这次是 `config.rs` 被吞。以后这类改动**一律 .py 文件**。
"""
import re
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

fixes = [
    ("✅ DONE：放在**视图菜单**勾选项。(`#[serde(default)]`)→thunk→sessionSlice→",
     "✅ DONE：放在**视图菜单**勾选项。链条 `config.rs`(`#[serde(default)]`)→`runtimeThunks`→`sessionSlice`→"),
]

n = 0
for a, b in fixes:
    if a in t:
        t = t.replace(a, b, 1)
        n += 1
P.write_text(t, encoding="utf-8")
print(f"✓ 修复 {n} 处被吞的内容")

# 体检：13/14/15 三行是否都在、且没有明显的"空括号"残缺
print("\n=== 关键行体检 ===")
for tag in ["| 12 |", "| 13 |", "| 14 |", "| 15 |"]:
    line = next((l for l in t.splitlines() if l.startswith(tag)), None)
    if line is None:
        print(f"  ✗ {tag} 缺失")
    else:
        # 反引号成对时才正常（奇数个=被吞过）
        ticks = line.count("`")
        mark = "✓" if ticks % 2 == 0 else "⚠ 反引号不成对"
        print(f"  {mark} {tag} 长度 {len(line)}，反引号 {ticks} 个")
