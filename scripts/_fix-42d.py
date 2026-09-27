#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#42 正解：**渲染后精确测量**，不再用常数 300 猜。

## 为什么不用"按项数估" 

看了源码：`MENUS` 只是名字数组（`menu_file` / `menu_track` …），
菜单项散落在渲染函数里（`{ label: t("menu_new_project"), action: ... }`），
**不是数据驱动的表** ⇒ 拿不到"这个菜单有几项"。
硬编码一张项数表 = 又埋一个会过期的常数（就是 #42 的病根）。

## 正解：首帧测量 + 修正

```
① 打开时先按**左对齐**渲染（anchorRight = false）
   —— 大多数菜单本来就该左对齐，直接对；
② useLayoutEffect 量菜单实际宽度，若 textLeft + width > innerWidth ⇒ 改右侧对齐
```

`useLayoutEffect` 在**浏览器 paint 之前**同步执行 ⇒ 用户看不到那次修正，
**没有可见跳动**。这是唯一"永远准"的办法（不依赖任何估算）。

⚠️ 需要给菜单 div 挂 ref。菜单是条件渲染的（`openMenu === name`），
ref 在它不在时是 null ⇒ 判空。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MT = ROOT / "upstream-src" / "frontend" / "src" / "components" / "mobile" / "MobileTopBar.tsx"
t = MT.read_text(encoding="utf-8")

# ── ① 判据：改成"先左对齐，测完再说" ──────────────────────────────────────
old1 = """                        // 宽菜单（「视图」约 300px）放不下时靠右上角。
                        setAnchorRight(textLeft + 300 > window.innerWidth);"""

new1 = """                        /* #42：这里原来写死 `textLeft + 300 > innerWidth`
                         *（"宽菜单「视图」约 300px"）—— 那是最宽菜单的估计，却对**所有**菜单用
                         * ⇒ 「轨道」只有 168px、`105+168=273 < 360` 明明放得下，
                         *   却被 `105+300=405 > 360` 判成放不下 ⇒ **一律靠右**。
                         *
                         * 改成：**先按左对齐渲染，再由 `useLayoutEffect` 量实际宽度修正**。
                         * 菜单项散在渲染函数里、拿不到"有几项"，任何常数估算都会重蹈覆辙。
                         */
                        setAnchorRight(false);"""

assert t.count(old1) == 1, f"① 锚命中 {t.count(old1)}"
t = t.replace(old1, new1, 1)
print("✓ ① 判据改为先左对齐")

# ── ② 加 ref + 测量 effect ────────────────────────────────────────────────
old2 = """    const [anchorLeft, setAnchorLeft] = React.useState(4);
    const [anchorRight, setAnchorRight] = React.useState(false);"""

new2 = """    const [anchorLeft, setAnchorLeft] = React.useState(4);
    const [anchorRight, setAnchorRight] = React.useState(false);
    /** #42：菜单浮层本体，供开面板后**实测宽度**用（paint 前修正，不可见）。 */
    const menuPanelRef = React.useRef<HTMLDivElement | null>(null);

    /* #42：菜单一旦渲染出来，就在**浏览器 paint 之前**量它的真实宽度。
     * 放不下（左边界 + 实际宽 > 视口）才切换到靠右 —— 不再靠常数猜。 */
    React.useLayoutEffect(() => {
        if (!openMenu) return;
        const el = menuPanelRef.current;
        if (!el) return;
        const w = el.getBoundingClientRect().width;
        const overflow = anchorLeft + w > window.innerWidth;
        // 只在需要时 setState；值没变 React 会 bail out，不会死循环。
        setAnchorRight((prev) => (prev === overflow ? prev : overflow));
    });"""

assert t.count(old2) == 1, f"② 锚命中 {t.count(old2)}"
t = t.replace(old2, new2, 1)
print("✓ ② 加 ref + useLayoutEffect 实测")

# ── ③ 把 ref 挂到菜单 div 上 ──────────────────────────────────────────────
old3 = """                    <div
                        role="menu"
                        className="absolute bg-qt-window border border-qt-border"
                        style={{
                            top: "100%","""

new3 = """                    <div
                        ref={menuPanelRef}
                        role="menu"
                        className="absolute bg-qt-window border border-qt-border"
                        style={{
                            top: "100%","""

assert t.count(old3) == 1, f"③ 锚命中 {t.count(old3)}"
t = t.replace(old3, new3, 1)
print("✓ ③ ref 已挂到菜单本体")

MT.write_text(t, encoding="utf-8")
