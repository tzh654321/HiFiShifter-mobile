#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 微调：减少工具行按钮间距（用户口径「用减少间距」）。

## ⚠️ 不能改 `BTN_BOX`

`MobileBottomBar.tsx:67-69` 的注释写得很明白：

    /** 命中区（≥40px：用户定的"命中区保持 40px"）。 */
    const BTN_BOX = 40;

⇒ 40px 是**用户定过的命中区下限**，改了会违反既有约定、也让手指更难按。

## 做法：负 margin

给工具行容器加一个语义类 `.hs-param-toolrow`，在其中把按钮的 `margin-inline` 收 -4px：
**视觉间距 40→36，命中区仍是 40**（负 margin 只让元素框互相重叠 4px，
`.hs-bar-btn` 的实际 `width/height` 不变 ⇒ `elementFromPoint` 命中区基本不受影响，
重叠处由**靠后的元素**接管 —— 相邻按钮语义独立，可接受）。

省下 8 个间隙 × 4px = 32px，足够让「下移」不再贴边。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 给工具行容器加语义类 ─────────────────────────────────────────────────
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")
old = '            className="shrink-0 relative flex items-center bg-qt-base border-b border-qt-border"'
assert t.count(old) == 1, "工具行容器锚不唯一"
t = t.replace(old,
    '            /* D1：加语义类，供 CSS 收紧按钮间距（不改命中区） */\n'
    '            className="hs-param-toolrow shrink-0 relative flex items-center bg-qt-base border-b border-qt-border"', 1)
MB.write_text(t, encoding="utf-8")
print("✓ 加了 .hs-param-toolrow 语义类")

# ── ② CSS：负 margin 收紧 ──────────────────────────────────────────────────
CSS = FE / "index.css"
c = CSS.read_text(encoding="utf-8")
if "hs-param-toolrow" not in c:
    c = c.rstrip("\n") + """

/*
 * D1：参数工具行的按钮间距收紧。
 *
 * ⚠️ 不改 `BTN_BOX`（40px 是用户定过的**命中区下限**）——
 * 这里用负 margin 只让元素框视觉重叠 4px，实际 width/height 不变，
 * 所以命中区仍是 40px，手指按起来不缩水。
 * 省下 8 个间隙 × 4px = 32px，让最右侧的「下移」不再贴屏幕边。
 */
.hs-param-toolrow .hs-bar-btn {
    margin-inline: -2px;
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ 加了收紧间距的 CSS")
else:
    print("· CSS 已存在")
