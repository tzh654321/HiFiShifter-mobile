#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 菜单定位（精度修正）+ #5 元音图超屏。

## #15（用户澄清后）
> 对于放不下的窗口应该放在右上角；「编辑」的窗口可以放下，但也没有看到
> 其左侧与「编辑」两字左侧对齐。

两句对应两件事：
  ① **放得下** ⇒ 菜单左边界要跟母菜单**文字**左边界对齐。
     差的就是 Trigger 自己的 `px-2`（8px）—— 菜单贴的是**按钮**左边，而用户看的是**文字**左边。
     ⇒ `alignOffset={-8}`。
  ② **放不下** ⇒ 靠**右上角**（右边界贴屏幕右边），而不是被 Radix 推到屏幕左边。
     判据：`触发器的 x + 菜单内容宽 > 视口宽` ⇒ 换成 `align="end"`。
     配合 `sticky="always"` + `collisionPadding={8}`，保证两侧都不会出屏。

## #5
`VowelChart` 是固定 `420×320` 的 SVG，而手机上浮窗被 `maxWidth: calc(100vw − 16px)`
压到 344px，扣掉 `px-3` + `p-2`（40px）后内容区只剩 ~304px ⇒ **图形右侧 116px 跑到屏幕外**。
⇒ 给 SVG 加 `maxWidth: 100%` + `height: auto`，靠 `viewBox` 等比缩放。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── #5：VowelChart 自适应宽度 ────────────────────────────────────────────────
vc = FE / "components" / "layout" / "timeline" / "clip" / "VowelChart.tsx"
t = vc.read_text(encoding="utf-8")
a = """            className="rounded border"
            style={{
                background: "var(--qt-graph-bg)","""
b = """            className="rounded border"
            style={{
                // 🔴 2026-09-24（#5）：SVG 原本是死宽 420，手机上浮窗被压到 344px、
                // 内容区只剩 ~304px ⇒ 右侧 116px 直接跑到屏幕外（用户报「部分图形在屏幕外」）。
                // 让它跟着容器缩：viewBox 会保证内容等比，height:auto 防止被压扁。
                maxWidth: "100%",
                height: "auto",
                background: "var(--qt-graph-bg)","""
assert t.count(a) == 1, "VowelChart style 锚不唯一"
t = t.replace(a, b, 1)
vc.write_text(t, encoding="utf-8")
print("✓ VowelChart.tsx：加 maxWidth:100% + height:auto（图形不再出屏）")

# ── #15①：菜单左边界对齐母菜单**文字** ─────────────────────────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

old_helper = """    function openMenuAt(e: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        document.documentElement.style.setProperty("--hs-menu-anchor", `${Math.max(0, r.left)}px`);
    }"""
new_helper = """    function openMenuAt(e: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const left = Math.max(0, r.left);
        document.documentElement.style.setProperty("--hs-menu-anchor", `${left}px`);
        // #15②：放不下就靠**右上角**。上界取「最宽菜单的内容宽」粗估（视图菜单约 460px）——
        // 宁可估大一点：宁可提前切到右对齐，也不要出现"先贴左再被推"的跳动。
        const EST_MENU_W = 460;
        setMenuAlign(left + EST_MENU_W > window.innerWidth ? "end" : "start");
    }"""
assert t.count(old_helper) == 1, "openMenuAt 锚不唯一"
t = t.replace(old_helper, new_helper, 1)

# 加 state（放在 openMenuAt 之前）
anchor = "    /**\n     * #15：打开菜单前把触发器的左边界写进 CSS 变量"
assert t.count(anchor) == 1, "helper 注释锚不唯一"
t = t.replace(
    anchor,
    "    /** #15：菜单水平对齐方向 —— 放得下用 start（左对齐母菜单文字），放不下用 end（靠右上角）。 */\n"
    "    const [menuAlign, setMenuAlign] = React.useState<\"start\" | \"end\">(\"start\");\n\n" + anchor,
    1,
)

# 每个 Content 加 align + 去掉重复的 collisionPadding 写法冲突
t = t.replace("<DropdownMenu.Content collisionPadding={4}", "<DropdownMenu.Content align={menuAlign} alignOffset={-8} collisionPadding={8} sticky=\"always\"")
t = t.replace("<DropdownMenu.SubContent collisionPadding={4}", "<DropdownMenu.SubContent align={menuAlign} alignOffset={-8} collisionPadding={8} sticky=\"always\"")
mb.write_text(t, encoding="utf-8")
print("✓ MenuBar.tsx：alignOffset={-8}（对齐文字）+ 动态 align（放不下靠右上角）+ sticky/collisionPadding")
