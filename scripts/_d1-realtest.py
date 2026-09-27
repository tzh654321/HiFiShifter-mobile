#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 布局定稿 + 真机实测记录。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊼ D1 布局定稿（用户口径）+ 真机实测

用户明确了两组的分工：

> 左对齐：🖱选择 ✏️绘制 👁参数覆盖层 ∨参数菜单（不变）
> 右对齐：📋复制 ✂️剪切 📄粘贴 ➕上移 ➖下移

⇒ 把「参数菜单」按钮**提到 5 个编辑按钮之前**（恢复左组原样），
并在编辑按钮组前插一个 `flex: 1 1 auto` 的撑开元素实现右对齐。

### ✅ 真机实测（221deeb，arm64 / 360 CSS 宽）

截图确认工具行顺序完全符合要求：

```
左：选择  绘制(高亮)  参数覆盖层  参数菜单
右：复制  剪切  粘贴  上移  下移
```

⚠️ **一个待优化点**：360 CSS 宽下 9 个按钮（每个 40px）**刚好占满**，
最右边的「下移」紧贴屏幕右缘，看起来像被裁掉一点。
⇒ 若要宽松些，可以：缩小 `.hs-bar-btn` 宽度 / 减小组间距 / 把「参数菜单」收进别处。

### 🕳️ 真机操作的坐标换算

页面切换失败两次，都是**坐标估算不准**。实测基准（1080×2376 物理 / 360×792 CSS，density 3）：

- 底栏页签：**y ≈ 2192**（不是 2310 —— 2310 会点到系统导航栏）
- 「参数」页签：**x ≈ 416**（1080/4 个页签 ⇒ 第 2 个中心 ≈ 405~420）

⇒ 以后真机点击前，**先用 `screencap` 量一次尺寸**（截图里 493×1071 ⇒ 物理 = 尺寸 × 2.19），
别凭记忆写坐标。
""", encoding="utf-8")
print("✓ memory ㊼ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| **D1** |")), None)
if old:
    t = t.replace(old, old.replace(
        "**实测**：手机 9 个按钮一行排布、位置连续、`hasBridge:true` ✅ |",
        "**实测**：手机 9 个按钮一行排布、位置连续、`hasBridge:true` ✅；"
        "**真机（221deeb / arm64）截图确认布局定稿** —— 左「选择/绘制/👁/参数菜单」、"
        "右「复制/剪切/粘贴/上移/下移」。⚠️ 360 CSS 宽下 9×40px 刚好占满，最右「下移」贴边 |"), 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：D1 补记真机实测")
else:
    print("· 没找到 D1 行")
