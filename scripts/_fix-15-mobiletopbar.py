#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 最终修正：真正的落点是 `MobileTopBar.tsx`，不是 `MenuBar.tsx`。

排查过程（值得记）：
  1. 先在 `MenuBar.tsx` 改（Radix 的 `alignOffset` / `collisionPadding` / `sticky`）—— **完全无效**；
  2. 用 CDP 读真机 DOM 才看出：那个「视图」按钮的 class 是
     `bg-transparent border-0 cursor-pointer`，**不是我改的 Trigger 的 class**；
  3. ⇒ 手机形态用的是 **`MobileTopBar.tsx` 自己实现的下拉**（`role="menu"` + 绝对定位），
     `MenuBar.tsx` 是**桌面/平板形态**的 Radix 菜单。**两套实现，我改错了文件。**

真凶是 L664 的**硬编码 `left: 4`** —— 菜单永远贴屏幕左边。

用户的两条要求：
  ① 放得下 ⇒ 左边界与母菜单**文字**左边界对齐。按钮有 `padding: "0 9px"`，
     所以 `left = 按钮.left + 9`。
  ② 放不下 ⇒ 靠**右上角**。判据 `按钮.left + 估宽 > 视口宽` ⇒ 改用 `right: 4`。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "upstream-src" / "frontend" / "src" / "components" / "mobile" / "MobileTopBar.tsx"
t = P.read_text(encoding="utf-8")

# ── ① 加两个 state ───────────────────────────────────────────────────────────
a = "    const [openMenu, setOpenMenu] = React.useState<MenuName | null>(null);"
b = """    const [openMenu, setOpenMenu] = React.useState<MenuName | null>(null);
    /**
     * #15：菜单面板的水平锚点。
     *   ① `anchorLeft` = 母菜单**文字**的左边界（按钮有 `padding: 0 9px`，所以要 +9）；
     *   ② `anchorRight` = 放不下时改用靠右对齐（用户口径「放不下的窗口应该放在右上角」）。
     * 之前这里是硬编码的 `left: 4`，所以菜单永远贴屏幕左边。
     */
    const [anchorLeft, setAnchorLeft] = React.useState(4);
    const [anchorRight, setAnchorRight] = React.useState(false);"""
assert t.count(a) == 1, "openMenu state 锚不唯一"
t = t.replace(a, b, 1)

# ── ② 菜单按钮的 onClick 里算锚点 ────────────────────────────────────────────
a = """                    onClick={() => {
                        setSubmenu(null);
                        setOpenMenu((v) => (v === name ? null : name));
                    }}"""
b = """                    onClick={(event) => {
                        setSubmenu(null);
                        const r = event.currentTarget.getBoundingClientRect();
                        // +9 = 按钮的 padding-left，让菜单左边界对齐**文字**而不是按钮。
                        const textLeft = Math.max(4, r.left + 9);
                        setAnchorLeft(textLeft);
                        // 宽菜单（「视图」约 300px）放不下时靠右上角。
                        setAnchorRight(textLeft + 300 > window.innerWidth);
                        setOpenMenu((v) => (v === name ? null : name));
                    }}"""
assert t.count(a) == 1, "菜单按钮 onClick 锚不唯一"
t = t.replace(a, b, 1)

# ── ③ 面板定位用它 ───────────────────────────────────────────────────────────
a = """                        style={{
                            top: "100%",
                            left: 4,"""
b = """                        style={{
                            top: "100%",
                            // #15：放得下 ⇒ 与母菜单文字左对齐；放不下 ⇒ 靠右上角。
                            left: anchorRight ? undefined : anchorLeft,
                            right: anchorRight ? 4 : undefined,"""
assert t.count(a) == 1, "面板 style 锚不唯一"
t = t.replace(a, b, 1)

P.write_text(t, encoding="utf-8")
print("✓ MobileTopBar.tsx：菜单锚点改为「对齐母菜单文字」+「放不下靠右上角」")
