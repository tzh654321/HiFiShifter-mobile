#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""去掉不再使用的 dx 参数（新实现只按纵向方向定型）。"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "timeline" / "clip" / "ClipEdgeHandles.tsx")
t = P.read_text(encoding="utf-8")

# 签名：resolveEdgeDragType = (dx: number, dy: number)
c1 = t.count("const resolveEdgeDragType = (dx: number, dy: number) => {")
t = t.replace("const resolveEdgeDragType = (dx: number, dy: number) => {",
              "const resolveEdgeDragType = (dy: number) => {")
print(f"✓ 签名 × {c1}")

# 调用点：resolveEdgeDragType(dx, dy)
c2 = t.count("resolveEdgeDragType(dx, dy),")
t = t.replace("resolveEdgeDragType(dx, dy),", "resolveEdgeDragType(dy),")
print(f"✓ 调用点 × {c2}")

P.write_text(t, encoding="utf-8")
