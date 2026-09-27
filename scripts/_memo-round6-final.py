#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㉖ 节 + 更新 TASKS.md。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉖ #15 的弯路与真凶：**手机上根本不是 Radix 菜单**

用户澄清后我改了 `MenuBar.tsx` 的 Radix 参数（`alignOffset` / `collisionPadding` / `sticky`），
**三轮构建全是白费** —— 实测菜单依旧 `left=4`。转折点是用 CDP 读真机 DOM：

```
{"btnAttrs":"type,aria-expanded,class,style",
 "btnClass":"bg-transparent border-0 cursor-pointer"}
```

这个 class **不是我改的那个 Trigger**（我的是 `shrink-0 rounded px-2 py-1 text-xs…`）
⇒ **手机形态用的是 `MobileTopBar.tsx` 自己实现的下拉**（`role="menu"` + 绝对定位），
`MenuBar.tsx` 的 Radix 菜单是**桌面/平板形态**才用的。**两套实现，我从头就改错了文件。**

真凶在 `MobileTopBar.tsx` **L664 的硬编码 `left: 4`** —— 菜单永远贴屏幕左边，
跟 Radix 的碰撞检测一点关系都没有。（顺带解释了为什么 `--hs-menu-anchor` 一直是空串：
那个变量只在 `MenuBar` 里设，手机上那个组件根本没挂载过。**我当时就该看出这个矛盾**。）

**🕳️ 教训（比修复本身值钱）**：
> 改 UI 之前，先用 CDP 读一遍**真机上实际渲染出来的元素 class / 属性**，
> 确认自己改的文件确实是那条渲染路径。同一个界面在两套布局下可能是**两份完全不同的实现**
> ——这个项目里 phone / tablet / desktop 三套布局就是这样。
> 只看源码 grep 会得出"我明明改对了"的错误结论。

### 修法与结果

`MobileTopBar.tsx`：
- 菜单按钮的 `onClick` 里量 `getBoundingClientRect()`；
- **+9px**（按钮的 `padding: 0 9px`）⇒ 对齐的是**文字**而不是按钮（这正是用户说的
  「没有看到其左侧与编辑两字左侧对齐」）；
- `文字左 + 300 > 视口宽` ⇒ 改走 `right: 4`（**右上角**）。

模拟器实测（360×731）：

| 菜单 | 母菜单文字左 | 菜单左 | 菜单右 | 结果 |
| :--- | ---: | ---: | ---: | :--- |
| 编辑（放得下） | 59 | **59** | 319 | ✅ 精确对齐文字 |
| 视图（放不下） | 151 | 132 | **356** | ✅ 靠右上角 |
| 帮助（放不下） | 243 | 188 | **356** | ✅ 靠右上角 |

（356 = 视口 360 − 4，符合 `right: 4` 的设计。）

### #5 同批修掉

`VowelChart` 是死宽 `420×320`，手机上浮窗被 `maxWidth: calc(100vw−16px)` 压到 344px，
扣掉内边距后内容区只剩 ~304px ⇒ **右侧 116px 图形跑到屏幕外**。加 `maxWidth:100%` + `height:auto`。
⚠️ 实测 `ClipFormantToolWindow.tsx` **没被任何对话改过**，是原版问题（用户以为另一个对话修过）。

### #13 与 #16

- **#13 确认无需改动**：用户给出的「正确分割」与模拟器现状**完全一致**。
- **#16 关闭**：用户查证「原作者还没把这项功能推送到 GitHub」，与我的核实一致。
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉖ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 15 |")), None)
if line:
    t = t.replace(line,
        "| 15 | 菜单别靠左 | ✅ **已修并实测通过**。🔴 关键：手机上用的是 **`MobileTopBar.tsx` 自己实现的下拉**，"
        "不是 `MenuBar.tsx` 的 Radix 菜单（我前两轮改错文件，全靠 CDP 读 DOM class 才发现）。"
        "真凶是 L664 硬编码 `left: 4`。修法：按钮 `onClick` 量 `rect.left + 9`（按钮 `padding:0 9px`，对齐的是**文字**）；"
        "`文字左+300 > 视口宽` ⇒ 改 `right: 4`（右上角）。实测 编辑=59↔59 对齐 / 视图·帮助 右边界=356 ✓ | A | DONE:09-24 |",
        1)
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md #15 更新为 DONE")
