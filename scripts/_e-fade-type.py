#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""加宽 `ClipEdgeHandles` 的 `startEditDrag` 类型（补 fade_in / fade_out）。"""
from pathlib import Path

F = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "timeline" / "clip" / "ClipEdgeHandles.tsx")
t = F.read_text(encoding="utf-8")

old = """    startEditDrag: (
        e: React.PointerEvent,
        clipId: string,
        type: "trim_left" | "trim_right" | "stretch_left" | "stretch_right",
    ) => void;"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """    startEditDrag: (
        e: React.PointerEvent,
        clipId: string,
        /**
         * ⚠️ 2026-09-26 加宽：补上 `fade_in` / `fade_out` ——
         * 它们本就是 `useEditDrag` 的 `EditDragType`（L178-179），
         * 只是这里收窄了。E 组要"长按控制点后上划调淡入淡出"，
         * 与 stretch 走同一个 `startEditDrag` 入口，不改实现。
         */
        type:
            | "trim_left"
            | "trim_right"
            | "stretch_left"
            | "stretch_right"
            | "fade_in"
            | "fade_out",
    ) => void;"""

t = t.replace(old, new, 1)
F.write_text(t, encoding="utf-8")
print("✓ startEditDrag 类型加宽（+fade_in/fade_out）")
