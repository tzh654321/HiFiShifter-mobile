#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#42 正解：把宽度约束提前到内联样式（修正 JSX 注释写法）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MB = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "MenuBar.tsx"
t = MB.read_text(encoding="utf-8")

OLD = '<DropdownMenu.Content align={menuAlign} alignOffset={-8} collisionPadding={8} sticky="always" variant="soft" color="gray" avoidCollisions={false}>'

# ⚠️ JSX 属性之间不能用 /* */，注释放到元素上方
NEW = ('{/* #42：**宽度必须写成内联 style** —— Radix 的碰撞检测在 CSS 生效\n'
       '                        之前、按元素**自然宽度**判"放不下"：菜单约 320px、母菜单在 x≈96\n'
       '                        ⇒ 96+320 > 360 判溢出 ⇒ 面板被推到右贴边；等 CSS 的 max-width\n'
       '                        压窄时定位已定完。内联样式**在测量之前**就在元素上 ⇒ 量到的就是\n'
       '                        窄宽度 ⇒ 不再推。式子与 CSS 里那条保持一致。 */}\n'
       '                <DropdownMenu.Content\n'
       '                    align={menuAlign}\n'
       '                    alignOffset={-8}\n'
       '                    collisionPadding={8}\n'
       '                    sticky="always"\n'
       '                    variant="soft"\n'
       '                    color="gray"\n'
       '                    avoidCollisions={false}\n'
       '                    style={{\n'
       '                        maxWidth: "calc(100vw - var(--hs-menu-anchor, 0px) - 8px)",\n'
       '                    }}\n'
       '                >')

c = t.count(OLD)
assert c >= 1, f"锚命中 {c} 次"
t = t.replace(OLD, NEW)
print(f"✓ Content 加内联 maxWidth × {c}")

MB.write_text(t, encoding="utf-8")
