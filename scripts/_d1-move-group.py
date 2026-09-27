#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 修正：把右对齐按钮组从「参数药丸容器内部」移到 `hs-param-toolbar` 的真正末尾。

## 问题

我按"缩进 20 的 `</Flex>`"找插入点，结果命中了一个**内层**容器的结束 ——
于是 5 个按钮变成了那个容器的最后一个子元素。
在手机上参数药丸容器是 `overflow-x: auto` 的，按钮被推到屏幕外 ⇒ **完全看不见**
（CDP 能查到按钮存在，但截图里没有）。

## 修正

移到 `hs-param-toolbar` 配对的 `</Flex>` 之前，使它成为工具栏的**最后一个顶层子元素**，
配合 `marginLeft: "auto"` 自然右对齐。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "PianoRollPanel.tsx")
t = P.read_text(encoding="utf-8")
lines = t.splitlines(keepends=True)

# ① 摘出我的组：从含 `marginLeft: "auto"` 的 <Flex 行，到紧随其后的第一个同缩进 </Flex>
i_flex = next(i for i, l in enumerate(lines) if 'marginLeft: "auto"' in l and "<Flex" in l)
# 往回一行是注释开头
i_start = i_flex
while i_start > 0 and lines[i_start - 1].strip().startswith(("{/*", "*", "全部复用", "所以长按")):
    i_start -= 1
ind = len(lines[i_flex]) - len(lines[i_flex].lstrip())
i_end = next(i for i in range(i_flex, len(lines))
             if lines[i].strip() == "</Flex>" and (len(lines[i]) - len(lines[i].lstrip())) == ind)
print(f"摘出范围: {i_start+1}..{i_end+1}")
group = lines[i_start:i_end + 1]
del lines[i_start:i_end + 1]

# ② 找 hs-param-toolbar 的配对 </Flex>
start = next(i for i, l in enumerate(lines) if 'className="hs-param-toolbar"' in l)
tind = len(lines[start]) - len(lines[start].lstrip())
i_close = next(i for i in range(start + 1, len(lines))
               if lines[i].strip() == "</Flex>" and (len(lines[i]) - len(lines[i].lstrip())) == tind)
print(f"hs-param-toolbar 结束: {i_close+1}")

# ③ 插到它之前（保持同样缩进）
lines[i_close:i_close] = group
Path(P).write_text("".join(lines), encoding="utf-8")
print("✓ 已移动到工具栏末尾")
