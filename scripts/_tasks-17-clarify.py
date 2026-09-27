#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 TASKS.md 的 #17 加上"要先确认的几件事"（删底栏会牵动功能入口）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 17 |")), None)
if line:
    new = ("| 17 | 删除底栏（轨道/参数/文件/笔记）及相关改动 | ⏸ **等确认后再动**：底栏现在承载着"
           "**`∧` 更多开关 / 撤销 / 重做 / 停止 / 播放 / 录制**，以及手机形态的**四个页签**。"
           "删掉之前需要先定：① 这些按钮**搬到哪**（顶栏？参数工具行？还是保留一条更矮的条）"
           "② 页签承担的「文件/记事本」是否并入顶栏菜单 ③ 「相关改动」具体指哪些"
           "（我曾为底栏写过 `∧` 折叠、页签高亮、平板常驻等逻辑，删的时候要一并清掉）| A | BLOCKED:待确认 |")
    t = t.replace(line, new, 1)
    P.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：#17 已加澄清项")
else:
    print("⚠️ 未找到 #17 行")
