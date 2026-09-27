#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组：给 `TimeRuler` 加 `onDoubleClick` prop。

组件是 `components/layout/timeline/TimeRuler.tsx`（不是 `TempoMapRulerRow` ——
后者是 Tempo Map 标尺行，两者都在参数编辑器里出现，容易混）。

已有 `onMouseDown`（L497 声明 / L532 解构 / L379 与 L751 使用），
照它的模式补一个同形的 prop 即可。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "timeline" / "TimeRuler.tsx")
t = P.read_text(encoding="utf-8")
n = 0

# ── ① props 声明 ────────────────────────────────────────────────────────────
a1 = "    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;"
assert t.count(a1) == 1, "onMouseDown 声明锚不唯一"
t = t.replace(a1, """    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
    /**
     * E 组（flm 交互表）：**双击拍数栏 = 移动进度条并开始播放**。
     * 单击的 seek 由 `onMouseDown` 负责，这里只补"起播"。
     */
    onDoubleClick?: () => void;""", 1)
n += 1
print("✓ props 声明")

# ── ② 解构 ──────────────────────────────────────────────────────────────────
a2 = "    onMouseDown,\n    onMouseDownAtSec,"
assert t.count(a2) == 1, "解构锚不唯一"
t = t.replace(a2, "    onMouseDown,\n    onDoubleClick,\n    onMouseDownAtSec,", 1)
n += 1
print("✓ 解构")

# ── ③ 挂到 L751 那个宿主元素（有 onMouseDown 的根）──────────────────────────
lines = t.splitlines(keepends=True)
i = next(i for i, l in enumerate(lines) if i + 1 == 751 or (751 <= i + 1 <= 760 and "onMouseDown={" in l))
ind = len(lines[i]) - len(lines[i].lstrip())
lines.insert(i + 1, " " * ind + f"onDoubleClick={{onDoubleClick}}\n")
t = "".join(lines)
n += 1
print(f"✓ 挂到 L{i + 1} 的宿主元素后")

P.write_text(t, encoding="utf-8")
print(f"共 {n} 处")
