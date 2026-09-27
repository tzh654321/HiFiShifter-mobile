#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 菜单别靠左，要靠在临近母菜单的地方（用户口径）。

实测（模拟器 360×731）：**「视图」在 x≈142，菜单面板却从 x≈10 开始**。
根因是 Radix 的**碰撞重定位**：菜单本身约 320px 宽，从 x=142 起算会右溢出屏幕
（142+320 > 360），于是 Popper 把整个面板往左推到能放下为止 —— 看起来就是"贴屏幕左边"。

两手一起改：
  1. CSS 限制菜单最大宽度 ⇒ 溢出量变小 ⇒ 重定位的位移也就变小；
  2. 给 `DropdownMenu.Content` 加 `collisionPadding={4}` ⇒ 允许它贴到离屏幕边 4px，
     而不是默认的 0（默认值会让它在还有空间时就提前挪位）。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① CSS：限制菜单宽度 ──────────────────────────────────────────────────────
css = FE / "index.css"
t = css.read_text(encoding="utf-8")
if "HS-MENU-ALIGN" not in t:
    anchor = """.rt-DropdownMenuContent,
.rt-SelectContent,
.rt-ContextMenuContent,
.rt-PopoverContent {
    z-index: 1000 !important;
}"""
    add = anchor + """

/* ── HS-MENU-ALIGN（2026-09-24）──────────────────────────────────────────────
 * 用户口径「菜单别靠左，要靠在临近母菜单的地方」。
 *
 * 实测：手机上「视图」在 x≈142，菜单却从 x≈10 起 —— 因为菜单约 320px 宽，
 * 从母菜单起算会右溢出（142+320 > 360，视口只有 360），Radix 的碰撞检测
 * 就把整个面板推到能放下为止。**先把宽度压到视口内够用**，位移自然小很多。
 * （真正让它"尽量贴母菜单"的是 JSX 里的 `collisionPadding={4}`，见 MenuBar.tsx。）
 */
.rt-DropdownMenuContent {
    max-width: calc(100vw - 20px) !important;
}"""
    assert t.count(anchor) == 1, "CSS 锚不唯一"
    t = t.replace(anchor, add, 1)
    css.write_text(t, encoding="utf-8")
    print("✓ index.css：菜单 max-width = calc(100vw - 20px)")
else:
    print("  · index.css 已有 HS-MENU-ALIGN")

# ── ② JSX：给所有 DropdownMenu.Content 加 collisionPadding ──────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

# 形如 <DropdownMenu.Content variant="soft" color="gray">（可能带其他属性）
pat = re.compile(r"<DropdownMenu\.Content(?![^>]*collisionPadding)([^>]*?)(\s*/?>)")
n = 0


def repl(m: re.Match) -> str:
    global n
    n += 1
    head, tail = m.group(1), m.group(2)
    return f'<DropdownMenu.Content collisionPadding={{4}}{head}{tail}'


t2 = pat.sub(repl, t)
if n:
    mb.write_text(t2, encoding="utf-8")

# 顶层 Root 的 Content 也要（上面正则已覆盖），另加 SubContent
print(f"✓ MenuBar.tsx：{n} 处 DropdownMenu.Content 加 collisionPadding={{4}}")

pat_sub = re.compile(r"<DropdownMenu\.SubContent(?![^>]*collisionPadding)([^>]*?)(\s*/?>)")
m = 0


def repl_sub(mo: re.Match) -> str:
    global m
    m += 1
    return f'<DropdownMenu.SubContent collisionPadding={{4}}{mo.group(1)}{mo.group(2)}'


t3 = pat_sub.sub(repl_sub, mb.read_text(encoding="utf-8"))
if m:
    mb.write_text(t3, encoding="utf-8")
print(f"✓ MenuBar.tsx：{m} 处 DropdownMenu.SubContent 加 collisionPadding={{4}}")
