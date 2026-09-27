#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#42 收尾：菜单固定左对齐，关掉 Radix 的自动避让。

改编 `setMenuAlign` 后实测**仍靠右**（`menuLeft=188`，贴着右边）
⇒ 说明是 **Radix 自己的 `avoidCollisions`** 把面板翻到右边去了
（`DropdownMenu.Content` 默认 `avoidCollisions` 为 true，
它按**内容的自然宽度**判"放不下"就翻转 —— 而 `--hs-menu-anchor` 的
`max-width` 是在**渲染之后**才压窄的，翻转判定发生在压窄之前）。

⇒ 既然我们已经用 CSS 保证"菜单永不溢出"
（`max-width: calc(100vw - var(--hs-menu-anchor) - 8px)`），
就不需要 Radix 再替我们避让 ⇒ **关掉它，让它老老实实左对齐**。
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
MB = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "MenuBar.tsx"
t = MB.read_text(encoding="utf-8")

# ① 判据固定为 start（保留 --hs-menu-anchor 的 max-width 兜底）
OLD = """            /* #15②：放不下就靠**右上角**。
             *
             * 🔴 #42 修正：原来写死 `460`（桌面最宽菜单的粗估，注释也写了"宁可估大"），
             * 但**手机屏宽只有 360** ⇒ `left + 460 > 360` **恒成立** ⇒
             * 手机上市面上每个菜单都靠右，跟"放不放得下"无关（用户报的「位置够却靠右」）。
             *
             * ⇒ 改成**按屏宽自适应**：桌面仍是 460（行为不变）；
             *   手机上取屏宽的 3/4 ⇒ 只有母菜单靠到屏幕右侧 3/4 之后才切右对齐。
             *
             * ⚠️ 有 CSS 兜底（`.rt-DropdownMenuContent { max-width:
             *   calc(100vw - var(--hs-menu-anchor) - 8px) }`）⇒ 估小也不会溢出。
             */
            const naturalWidth = Math.min(460, Math.round(window.innerWidth * 0.5));
            setMenuAlign(left + naturalWidth > window.innerWidth ? "end" : "start");"""

NEW = """            /* 🔴 #42：**固定左对齐**。
             *
             * 演进史：原来是 `left + 460 > innerWidth`（桌面最宽菜单的粗估，
             * 注释写明"宁可估大"）⇒ **手机屏宽才 360 ⇒ 恒成立 ⇒ 每个菜单都靠右**。
             * 按屏宽自适应改小后**实测仍靠右**（`menuLeft=188` 贴右边）——
             * 真凶是 **Radix 自己的 `avoidCollisions`**：它按**内容自然宽度**判"放不下"
             * 就翻转，而 `--hs-menu-anchor` 的 `max-width` 是**渲染后**才压窄的，
             * 翻转判定发生在压窄之前 ⇒ 永远判"放不下"。
             *
             * ⇒ 既然 CSS 已保证菜单**永不溢出**（上面那条 max-width），
             *   就不需要 Radix 再避让 ⇒ `align="start"` + `avoidCollisions={false}`。
             */
            setMenuAlign("start");"""

assert t.count(OLD) == 1, f"判据锚命中 {t.count(OLD)} 次"
t = t.replace(OLD, NEW, 1)
print("✓ 判据固定 start")

# ② 所有 Content 加 avoidCollisions={false}
c = t.count('collisionPadding={8} sticky="always" variant="soft" color="gray"')
t = t.replace('collisionPadding={8} sticky="always" variant="soft" color="gray"',
              'collisionPadding={8} sticky="always" variant="soft" color="gray" avoidCollisions={false}')
print(f"✓ avoidCollisions=false × {c}")

MB.write_text(t, encoding="utf-8")
