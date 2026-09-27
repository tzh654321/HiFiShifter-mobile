#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""轨道头左划：整列隐藏 → 收窄窄条（只留颜色圆点/电平条）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src" / "index.css"
t = P.read_text(encoding="utf-8")

old = """body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    display: none;
}"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    /* ⚠️ 2026-09-26 修正：原为 `display: none`（整列藏掉）—— 过头了。
       规格表写的是「左划隐藏轨道头，**只留轨道颜色线与电平条**，右划再展开」，
       即收窄成一条窄边，保留颜色识别与电平指示。 */
    width: 26px !important;
    min-width: 0 !important;
    overflow: hidden;
}

/* 窄条里只留色块（颜色圆点 / 电平条）—— 文字与输入框让位。
   ⚠️ **按钮不能全隐藏**：颜色圆点本身就是 button（实测 32×32），
   藏掉按钮就没有颜色识别了；超出宽度的部分交给 overflow:hidden 裁。 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] .rt-Text,
body[data-hs-header-collapsed="1"] [data-track-list-panel] input {
    display: none !important;
}"""

t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ CSS：整列隐藏 → 26px 窄条")
