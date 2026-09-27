#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B2 再修正：`↘MID` 的 variant 必须是 ghost。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## B2 再修正：`↘MID` 用 `variant="ghost"`（对齐 `0050` 那张真机图）

### 用户口径（关键的一句）

> 我要的 v 菜单是几乎与曾经的版本（**0050-真机-选项菜单.png**）一致的，
> 不要五个新按钮，**唯一要更改的地方是正方形的 ↘MID，且要图标化**。

⇒ 对着 `0050` 那张图看，v 菜单的**正确布局**是：

```
第一行：🔗(同步)  │  ↗ ↘(暗) ♪(拖动方向3个)  🔒(锁)  [↘MID]
第二行：参考轨道组 ∨      算法 nsf-hifigan ∨
第三行：平滑度: ●———— 0%
```

⇒ `↘MID` 之所以看着像"文字方块"，是因为它原本是 **`Button`（`variant=soft`，带底色）**，
而左右邻居全是**无底色的图标按钮**。

### 我改错在哪

第一版改成了 `IconButton` + `MidiIcon`，但**保留了 `variant="soft"`** ⇒
仍然有方块底色 ⇒ 视觉上还是"方框里的图标"，**比例依然与旁边不一致**。

⇒ 正确写法：**`variant="ghost"`**（与旁边那排拖动方向/锁一致）。

**✅ 实测**（模拟器 CDP）：

```
class: rt-r-size-1 rt-variant-ghost rt-IconB...
background-color: rgba(0, 0, 0, 0)     ← 无底色 ✅
```

### 教训

**"改成图标"不只是换内容，还要换容器样式。**
判断"与旁边一致"要看**计算样式**（`getComputedStyle(el).backgroundColor` / `borderRadius` /
`padding`），不是只看标签类型 —— 都是 `<IconButton>` 也可能一个 `soft` 一个 `ghost`。

---

## 关于「5 个新按钮」的澄清

用户说"不要五个新按钮"，指的是它们**不该出现在 v 菜单里**；
D1 要求的是把它们放在**上工具栏右对齐处**（工具行上那 5 个 📋 ✂️ 📄 ➕ ➖ 是对的）。

⇒ 已用 `body[data-hs-param-menu="open"] .hs-param-toolrow .hs-edit-btn { display: none !important }`
在 v 菜单打开时隐藏（**必须 `!important`**：`BarButton` 的 `display` 是内联样式）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| **B2** |") or l.startswith("| B2 |")), None)
if old:
    t = t.replace(old, old.rstrip(" |") + " ⚠️ **再修正**：`variant` 从 `soft` 改为 **`ghost`** —— "
        "`soft` 带底色，视觉上仍是「方框里的图标」，与旁边一排 ghost 图标按钮**比例不一致**；"
        "实测 class `rt-variant-ghost`、`background-color: rgba(0,0,0,0)` ✅。"
        "（位置一直在「锁」右边，未动。）|", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：B2 补记 variant 修正")
else:
    print("· 没找到 B2 行")
