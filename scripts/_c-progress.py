#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C 进展记录（底栏已删，菜单项待接）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊿⁺ C（#17 删底栏）进展：底栏已删，菜单项还没接上

### ✅ 已完成并验证

**底栏确实删掉了** —— 真机/模拟器截图确认：底部只剩工具条
（`∧` / 撤销 / 重做 / 停止 / 播放 / 录制），**「轨道/参数/文件/笔记」那行没有了**。
CDP 也确认 `document.querySelector('nav')` 为 `null`、`bottomTabs: []`。

### 本轮改了什么

1. `sessionTypes`：加 `MobilePanelKey` / `MobilePanels`
2. `sessionSlice`：`mobilePanels` state（默认只开 `timeline`）+ `toggleMobilePanel`（**含"至少留一个"守卫**）
   + `showMobilePanel`（B4 过页用）
3. `App.tsx`：`mobileTab` 单选 ⇒ `mobilePanels` 四个 boolean；面板区**垂直分屏**（勾几个分几块）；
   删掉 `<BottomTabs>`
4. `MenuBar`：视图菜单加 4 个 `withCheck` 勾选项
5. i18n：zh/en 各补 4 个面板名

### ⚠️ 未完成 / 待定位

**我加的 4 个菜单项没渲染出来**（截图里视图菜单只有上游原有的
「文件面板 / 记事本」，没有我加的「轨道面板 / 参数面板 / 文件浏览器 / 记事本」）。
tsc 全绿、代码确实在（`MenuBar.tsx` 的 View Menu 里），但运行时不出现在菜单中。

🔑 **截图给出的关键线索**：菜单里**本来就有**「**文件面板**」「**记事本**」两项，
而且它们的 i18n key 是 `file_panel` / `notebook`（`zh-CN.ts:185-186`），
**不是**我新加的 `menu_view_panel_*`。
⇒ 上游**已有**面板显隐这一半能力（`MobileTopBar.tsx:343-344` 用
`onToggleFiles` / `onToggleNotebook`，`MobileTopBar:662-663` 还有图标版）。

⇒ **下一轮正确做法**：**先找到那两项的渲染位置与它们读的 state**，
然后**复用同一套**，只补「轨道/参数」两项并把手势/拖拽接上；
而不是像本轮这样另起一套 parallel 的 state + 菜单项。

### 🕳️ 本轮的三个坑（都已修，但值得记）

1. **`sessionSlice` 的 actions 是「解构导出」的**：
   reducer 写进 `reducers: {}` 还不够，必须在文件末尾
   `export const { ... } = sessionSlice.actions;` 里**再加一行**，
   否则别处 import 会报 `has no exported member`。**加了 action 一定要同时改解构列表。**
2. **`MenuBar` 的 selector 是显式列字段的**：新增 `s.xxx` 之前要先把 `xxx` 加进那个
   `useAppSelector` 返回对象，否则 `Property 'xxx' does not exist`。
3. **脚本拼 import 时又留了双逗号**（`TrackInfo,, MobilePanels`）—— 这已经是**第三次**。
   ⇒ 记死：**不要"在原串尾部拼"**（原串可能已带尾逗号），要**整块替换**。
""", encoding="utf-8")
print("✓ memory ㊿⁺ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| C |") or l.startswith("| **C** |")), None)
if old:
    t = t.replace(old,
        "| C | **删底栏**（→ 勾选项进「视图」菜单）| 🟡 **底栏已删（实测确认），菜单项待接**。"
        "① `MobilePanelKey`/`MobilePanels` 类型；② `sessionSlice` 加 `mobilePanels` state（默认只开 timeline）"
        "+ `toggleMobilePanel`（**含「至少留一个」守卫**）+ `showMobilePanel`（B4 过页用）；"
        "③ `App.tsx`：单选 `mobileTab` ⇒ 四 boolean + **垂直分屏**，删 `<BottomTabs>`；"
        "④ `MenuBar` 视图菜单加 4 个 `withCheck` 项；⑤ i18n zh/en 各补 4 名。"
        "**实测**：底部只剩工具条，「轨道/参数/文件/笔记」那行没了 ✅；`nav` 为 null ✅。"
        "⚠️ **未完成**：**我加的 4 项没渲染**（菜单里只有上游原有的「文件面板/记事本」，"
        "key 是 `file_panel`/`notebook`）。🔑 上游**已有**面板显隐一半能力"
        "（`MobileTopBar:343-344` 的 `onToggleFiles`/`onToggleNotebook`）⇒ 下一轮应**复用同一套**，"
        "只补「轨道/参数」两项 |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：C 进度已更新")
else:
    print("· 没找到 C 行")
