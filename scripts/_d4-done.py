#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D4 完成：补记平移 + 修「点角标」偏差。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── memory ──────────────────────────────────────────────────────────────────
MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊺ D4 完成并实测通过（含一个自己发现的偏差）

### 补上的两件事

**① 参数区单指平移**（D4 的核心行为）

在 `onCanvasPointerDown` 的**最前面**加 `drag` 分支：记录起点 + `scroller.scrollLeft/scrollTop`，
`move` 时 `scrollLeft = startLeft - dx`（内容跟手走），然后 `syncScrollLeft(scroller)`；
用原生 `window` 监听（与同文件 `onRulerMouseDown` 同一模式），划出画布也能继续拖。

⚠️ 放在最前面并直接 `return` ⇒ **连"按下即 seek"都不做** ——
这正是用户要的「只有单击拍数栏会改变进度条」。
拍数栏的 seek 走 `onRulerMouseDown`，与此无关，所以两条语义天然不冲突。

**② 🔴 自己发现一个偏差：角标不能点**

用户口径是「**点三角**使其变为菜单」，但我初版只在角标上放了 `data-hs-select-corner`
（一个纯装饰 span），**点击会冒泡到按钮本体 ⇒ 结果是切到"选择"而不是开菜单**，
只有长按 400ms 才开 —— 与要求不符。

⇒ 修：给角标加 `onClick`（`stopPropagation` + `preventDefault`）+ `onPointerDown` 挡冒泡，
并把命中区放大到 **14×14**（图形仍只画 6×6；`right/bottom: -4` 让手指够得着）。

⚠️ 顺带确认：**铅笔的角标也有同样问题**（装饰 span，不可点），但用户没提，
所以这次**只改选择工具**，保持与既有行为一致、不扩大改动面。

### ✅ 实测（模拟器 CDP，全部通过）

| 验证项 | 结果 |
| :--- | :--- |
| `[data-hs-select-corner]` / `[data-hs-select-anchor]` 存在 | ✅ |
| **点角标** → 菜单打开 | ✅ `corner-clicked` |
| 菜单项内容 | ✅ `["选择", "拖动"]` |
| 点「拖动」→ 切换成功 | ✅ `picked: true` |
| **单指拖 → 视野平移** | ✅ `scrollLeft 0 → 185` |

### 🕳️ 再次确认：`adb shell input` 发的是 **mouse** 事件

长按选择按钮（`input swipe x y x y 700`）**没能打开菜单** ——
因为我的长按守卫是 `if (e.pointerType === "mouse") return;`（防止鼠标误触发）。
⇒ 说明 `input` 注入的 pointer 类型是 `mouse`，**长按/多指类手势它测不了**（第四次撞上）。

⚠️ 但**单指拖这类 mouse 也能做的操作是可以测的**（本次平移就测通了）。
⇒ 判据：**分支里有没有 `pointerType` 守卫** —— 有则测不了，没有则能测。
这比"盲试"省时间得多。
""", encoding="utf-8")
print("✓ memory ㊺ 已追加")

# ── TASKS ───────────────────────────────────────────────────────────────────
T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| **D4** |")), None)
assert old, "找不到 D4 行"
t = t.replace(old,
    "| **D4** | 选择工具加三角 + 「拖动」工具（手套）| ✅ **已完成 + 实测通过**。"
    "① `ToolModeGroup`/`ToolMode` 加 `\\\"drag\\\"`，`setToolMode` 里 drag 单独成组且**不覆盖 `drawToolMode`**；"
    "② 上游用 `toolMode !== \\\"select\\\"` 表达「绘制类」，会误放行 drag ⇒ 收口成 `isDrawToolMode()`；"
    "③ 光标 drag ⇒ `grab`；④ 「选择」按钮加角标（**角标可点**，含命中区放大到 14×14）+ 长按菜单 "
    "`SelectToolMenu`（选择/拖动）+ `IconGlove` + CSS + i18n；"
    "⑤ **参数区单指平移**：在 `onCanvasPointerDown` 最前面加 drag 分支（内容跟手走 + `syncScrollLeft`），"
    "拖完直接 return ⇒ 连「按下即 seek」都不做，故「只有单击拍数栏改进度条」成立。"
    "**实测**：点角标开菜单 ✅ / 菜单 `[选择, 拖动]` ✅ / 切拖动 ✅ / 单指拖 `scrollLeft 0→185` ✅ |",
    1)
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md：D4 标记为已完成")
