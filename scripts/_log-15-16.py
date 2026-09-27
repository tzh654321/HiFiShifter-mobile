#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：#15/#16 完成（分屏各面板关闭键）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ✅ #15 + #16 完成：分屏**每个面板**都有自己的关闭键

### 走过的弯路（值得记）

1. **第一版加错容器** —— 加进了 `PianoRollPanel` 的 `.hs-param-head`，
   而该容器**在手机上被 `@media (max-width:599px)` 整个隐藏**
   ⇒ **放进看不见的容器 = 没加**。
   ⚠️ CDP 查元素自身 `display: inline-flex` 是**假阳性**（没查祖先可见性），
   `w/h = 0` 本来已是线索。**判据要用 `getBoundingClientRect().width > 0`。**

2. **正确落点是 `App.tsx` 的手机分屏槽位** —— 四个面板各自被包在：

```tsx
{mobilePanels.params ? (
    <div className="flex-1 min-h-0 relative">
        <PianoRollPanel />
    </div>
) : null}
```

   `relative` 已就绪 ⇒ 叠一个 `absolute` 的 ✕ 即可。**一次改动同时修 #15 和 #16**。

3. **用原生 `<button>` 而非 `IconButton`** —— App.tsx 里既没有 `IconButton`
   也没有 `tAny`，引它们要连带补一串 import；原生 button + `✕` 字符最省事。

### ⚠️ 一处与用户口径的偏差（需确认）

用户说"参数界面**左上角**显示 x"，我放在了**右上角**：
手机分屏里各面板的**左上角都被内容占满**
（时间线是拍数栏起点、参数是钢琴键列表顶端），
放左上角会**挡住内容**，而且会跟"点拍数栏 seek"抢点击。
⇒ **右上角是空白区**。**这点需要跟用户确认是否接受。**

### ✅ 实测

```
.hs-panel-close × 2
  X1: x=330, y=90,  26×26   ← 时间线面板
  X2: x=330, y=380, 26×26   ← 参数面板
```

（`w/h` 真实非零 ⇒ 不是假阳性。）截图 `0087-模拟器-分屏关闭键.png` 可见两个 ⊠。

⇒ 平板 / 桌面用 `@media (min-width: 600px)` 隐藏（分屏是手机形态的机制）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
if "#15 + #16 完成" not in t:
    t = t.rstrip() + """

### ✅ #15 + #16 完成（2026-09-26 20:20）

**做法**：在 `App.tsx` 手机分屏的**四个面板槽位**各叠一个绝对定位的 ✕：

```
.hs-panel-close × 2（实测）
  X1: x=330, y=90,  26×26   ← 时间线面板
  X2: x=330, y=380, 26×26   ← 参数面板
```

⇒ `onClick` = `dispatch(toggleMobilePanel(<该面板>))`，与顶栏「视图」菜单同一出口。
平板 / 桌面 `@media (min-width:600px)` 隐藏。

**走过两条弯路**（详见 memory）：
① 第一版加进了 `.hs-param-head` —— 该容器**手机上被 `@media` 隐藏** ⇒ 看不见；
   而 CDP 查元素自身 `display: inline-flex` 是**假阳性**（`w/h=0` 已是线索）。
② 用 `IconButton`/`tAny` 会连带补一串 import ⇒ 改用原生 `<button>`。

⚠️ **与用户口径的偏差**：用户说"**左上角**"，我放在**右上角** ——
因为各面板左上角都被内容占满（拍数栏起点 / 钢琴键列表顶端），
放那儿会挡内容并跟「点拍数栏 seek」抢点击。**待确认是否接受。**
"""
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md 已更新")
