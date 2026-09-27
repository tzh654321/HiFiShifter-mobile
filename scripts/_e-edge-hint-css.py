#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""长按控制点时的视觉提示（代替"变速缩放图标"的第一版）。

规格说「长按 ⇒ **其上方出现淡入/淡出图标，下方出现变速缩放图标**」。
图标本身要画，先用一个**明确的视觉提示**顶上：
长按后控制点加高亮描边 + 旁边浮出「变速」字样（伪元素，不新加 DOM）。

`ClipEdgeHandles` 已在长按时给宿主打 `data-hs-edge-long-press="1"`，
这里直接用属性选择器接上。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "upstream-src" / "frontend" / "src" / "index.css"
c = CSS.read_text(encoding="utf-8")

if "hs-edge-long-press" not in c:
    c = c.rstrip("\n") + """

/*
 * E 组（音频块头尾控制点）：「长按 ⇒ 变速缩放」的**视觉提示**。
 *
 * `ClipEdgeHandles` 在长按达 500ms 时给控制点打 `data-hs-edge-long-press="1"`
 * —— 这里据此高亮边缘并浮出「变速」字样。
 *
 * ⚠️ 规格原文是「下方出现**变速缩放图标**」；图标待画，当前先用文字气泡顶上。
 *    用伪元素而非新增 DOM：控制点是绝对定位的细条，加子元素会改变它的命中区。
 */
[data-hs-edge-long-press="1"] {
    box-shadow: inset 0 0 0 2px rgb(96 165 250 / 0.9);
}
[data-hs-edge-long-press="1"]::after {
    content: "变速";
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font-size: 10px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 4px;
    background: rgb(37 99 235);
    color: #fff;
    pointer-events: none;
    z-index: 70;
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ index.css：长按提示（高亮 + 「变速」气泡）")
else:
    print("  · 已存在")
