#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 正解：让菜单宽度跟着触发器位置自适应，从而能左对齐母菜单。

上一版只做了「CSS 限宽 + collisionPadding」，实测**不够** —— 因为根因是几何问题：
菜单内容约 300px 宽，而「视图」触发器在 x=142，`142+300 > 360`（视口），
Radix 的碰撞检测**必须**把面板左推才能放得下。

正解：把触发器的左边距写进 CSS 变量，让菜单的 `max-width` 变成
`视口宽 − 触发器x − 8`。这样菜单就能从母菜单位置开始、右边刚好贴屏幕边。

⚠️ 不能用 `avoidCollisions={false}`：那会让菜单右溢出，右侧内容直接看不见，比"靠左"更糟。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① CSS：max-width 用变量 ──────────────────────────────────────────────────
css = FE / "index.css"
t = css.read_text(encoding="utf-8")
old = """.rt-DropdownMenuContent {
    max-width: calc(100vw - 20px) !important;
}"""
new = """.rt-DropdownMenuContent {
    /* 宽度跟着「触发器的左边界」走：视口宽 − 锚点x − 8。锚点由 MenuBar 在打开菜单时写进
     * `--hs-menu-anchor`（见该文件里的 openMenuAt）。这样菜单能左对齐母菜单、右边刚好贴屏幕边，
     * 而不必因为"放不下"被 Radix 整体左推（用户报的「菜单别靠左」就是这个）。 */
    max-width: calc(100vw - var(--hs-menu-anchor, 0px) - 8px) !important;
}"""
assert t.count(old) == 1, "CSS max-width 锚不唯一"
t = t.replace(old, new, 1)
css.write_text(t, encoding="utf-8")
print("✓ index.css：max-width 改用 --hs-menu-anchor")

# ── ② MenuBar：Trigger 上记录锚点 x ──────────────────────────────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

# 统一注入口：在组件里加一个小工具函数（放在 shortcutLabel 前面）
helper = '''    /**
     * #15：打开菜单前把触发器的左边界写进 CSS 变量，供 `.rt-DropdownMenuContent` 算 max-width。
     * Radix 的 Content 渲染在 Portal 里，但 CSS 变量定义在 `:root` 上照样能继承到。
     */
    function openMenuAt(e: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        document.documentElement.style.setProperty("--hs-menu-anchor", `${Math.max(0, r.left)}px`);
    }

'''
anchor = "    function shortcutLabel(actionId: ActionId): string {"
assert t.count(anchor) == 1, "shortcutLabel 锚不唯一"
t = t.replace(anchor, helper + anchor, 1)

# 给每个菜单的 Trigger 挂上 onPointerDown
n = 0
pat = re.compile(r"<DropdownMenu\.Trigger(?![^>]*openMenuAt)([^>]*?)>")


def repl(m: re.Match) -> str:
    global n
    n += 1
    return f"<DropdownMenu.Trigger onPointerDown={{openMenuAt}}{m.group(1)}>"


t = pat.sub(repl, t)
mb.write_text(t, encoding="utf-8")
print(f"✓ MenuBar.tsx：{n} 个 DropdownMenu.Trigger 挂上 openMenuAt")
