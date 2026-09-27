#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正窄条 CSS：不能隐藏 button（颜色圆点就是 button）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src" / "index.css"
t = P.read_text(encoding="utf-8")

old = """/* 窄条里只留色块（颜色条 / 电平条），文字与按钮全部让位。 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] button,
body[data-hs-header-collapsed="1"] [data-track-list-panel] .rt-Text,
body[data-hs-header-collapsed="1"] [data-track-list-panel] input {
    display: none !important;
}"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """/* 窄条里只留色块（颜色圆点 / 电平条）—— 文字与输入框让位。
   ⚠️ **按钮不能全隐藏**：颜色圆点本身就是 button（实测 32×32），
   藏掉按钮就没有颜色识别了；超出窄条宽度的部分交给 overflow:hidden 裁。 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] .rt-Text,
body[data-hs-header-collapsed="1"] [data-track-list-panel] input {
    display: none !important;
}"""

t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ CSS 修正：保留 button（颜色圆点）")
