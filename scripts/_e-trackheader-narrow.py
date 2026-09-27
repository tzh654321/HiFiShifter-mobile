#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正：轨道头左划应是「**只留轨道颜色线与电平条**」，不是整列隐藏。

规格表原文（轨道头 · 划动）：

> 上下划平移视野，**左划隐藏轨道头，只留轨道颜色线与电平条**，右划再展开

我第一版用 `display: none` 把整列藏了 —— **过头了**。
正确形态是**收窄成一条窄边**（留下颜色识别 + 电平指示），再左划/右划切换。

## 做法

把 `display: none` 换成「**收窄 + 隐藏文字控件**」：

```css
body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    width: 26px;          /* 只留窄条 */
    overflow: hidden;
}
/* 窄条里藏掉所有文字/按钮，只留颜色条与电平条（它们是无文字的色块） */
body[data-hs-header-collapsed="1"] [data-track-list-panel] button,
body[data-hs-header-collapsed="1"] [data-track-list-panel] .rt-Text {
    display: none;
}
```

⚠️ 用 `!important` 的地方：Radix 的 `rt-Text` 有自己的 display，且部分控件是内联样式。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
CSS = FE / "index.css"
c = CSS.read_text(encoding="utf-8")

old = """body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    display: none;
}"""
assert c.count(old) == 1, "折叠规则锚不唯一"

new = """/*
 * ⚠️ 2026-09-26 修正：原实现是 `display: none`（整列藏掉）—— **过头了**。
 * 规格表写的是「左划隐藏轨道头，**只留轨道颜色线与电平条**，右划再展开」，
 * 即收窄成一条窄边，保留颜色识别与电平指示。
 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    width: 26px !important;
    min-width: 0 !important;
    overflow: hidden;
}
/* 窄条里只留色块（颜色条 / 电平条），文字与按钮全部让位。 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] button,
body[data-hs-header-collapsed="1"] [data-track-list-panel] .rt-Text,
body[data-hs-header-collapsed="1"] [data-track-list-panel] input {
    display: none !important;
}"""
c = c.replace(old, new, 1)
CSS.write_text(c, encoding="utf-8")
print("✓ index.css：整列隐藏 → 收窄成 26px 窄条（留颜色线/电平条）")
