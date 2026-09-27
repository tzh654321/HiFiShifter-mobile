#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 布局微调（用户口径）：

> 左对齐：🖱选择 ✏️绘制 👁参数覆盖层 ∨参数菜单（不变）
> 右对齐：📋复制 ✂️剪切 📄粘贴 ➕上移 ➖下移

⇒ 两处改动：
  ① 把「参数菜单」按钮**提到 5 个编辑按钮之前**（恢复左组原样：选择/绘制/👁/∨）；
  ② 给 5 个编辑按钮包一个 `ml-auto` 容器（或直接给第一个加 margin-left:auto）。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "mobile" / "MobileBottomBar.tsx")
t = P.read_text(encoding="utf-8")
lines = t.splitlines(keepends=True)

# ① 摘出「参数菜单」的 BarButton 块（含它前面的注释）
i_note = next(i for i, l in enumerate(lines) if "∨ 参数菜单（新增）" in l)
ind = len(lines[i_note]) - len(lines[i_note].lstrip())
i_end = next(i for i in range(i_note, len(lines))
             if lines[i].strip() == "</BarButton>" and (len(lines[i]) - len(lines[i].lstrip())) == ind)
menu_block = lines[i_note:i_end + 1]
del lines[i_note:i_end + 1]
print(f"摘出「参数菜单」: {i_note+1}..{i_end+1}")

# ② 插回 5 个编辑按钮**之前**（即我加的那组注释之前）
i_group = next(i for i, l in enumerate(lines) if "D1：选区编辑（复制/剪切/粘贴/上移/下移）" in l)
# 注释块起点：往上找 `{/*` 那行
while i_group > 0 and not lines[i_group].strip().startswith("{/*"):
    i_group -= 1
lines[i_group:i_group] = menu_block
print(f"插回位置: {i_group+1}（5 个编辑按钮之前）")

# ③ 给编辑按钮组加 ml-auto：把注释后紧跟的第一个 BarButton 包一层容器太啰嗦，
#    改为在组内第一个按钮前插一个「占位撑开」元素（更贴近既有 toolbar 的写法）
i_grp2 = next(i for i, l in enumerate(lines) if "D1：选区编辑（复制/剪切/粘贴/上移/下移）" in l)
while i_grp2 > 0 and not lines[i_grp2].strip().startswith("{/*"):
    i_grp2 -= 1
# 找该注释块结尾 `*/}` 之后的第一行
i_first_btn = next(i for i in range(i_grp2, len(lines)) if "<BarButton" in lines[i])
indent = " " * (len(lines[i_first_btn]) - len(lines[i_first_btn].lstrip()))
spacer = [f'{indent}<span style={{{{ flex: "1 1 auto" }}}} aria-hidden="true" />\n']
lines[i_first_btn:i_first_btn] = spacer
print(f"插入撑开元素: {i_first_btn+1}")

Path(P).write_text("".join(lines), encoding="utf-8")
print("✓ 布局调整完成")
