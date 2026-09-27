#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C（#17 删底栏）完成记录 —— 第 6 轮 9 项全部交付。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## C（#17 删底栏）完成 —— 第 6 轮 9 项全部交付

### 🔑 最后一块拼图：手机顶部是 `MobileTopBar`，不是 `MenuBar`

我在 `MenuBar.tsx` 的 View Menu 里加了 4 项，**手机上完全不出现**。
根因：`MobileTopBar.tsx` **第一行注释**就写着

> 桌面 MenuBar 的语义保留（文件/编辑/轨道/视图/选项/帮助）。

⇒ **手机顶部是它自绘的一套触摸实现**（`MenuBar` 在手机上不渲染）。
它里面有 `menu_view: [...]` 数组，才是手机「视图」菜单的真正内容。

**顺带发现一个上游没接完的地方**：该数组里本来就有

```
// 侧栏开关（原来只有平板顶栏那两个图标，菜单里也给一份，手机也能开合）
{ label: t("file_panel"), action: onToggleFiles },
{ label: t("notebook"),   action: onToggleNotebook },
```

注释明说「**手机也能开合**」，但 `App.tsx:3966-3967` 传的是
`onToggleFiles={isTablet ? () => dispatch(...) : undefined}`
⇒ **手机拿到 `undefined`，点了没反应**。

### 最终做法

手机是**单面板**（`mobilePanels`），平板是**侧栏**（`fileBrowserSlice` / `notebookSlice`），
两套语义不同 ⇒ **不动平板的**，只在 `MobileTopBar.menu_view` 里按 `wide` 分流：

- 新增「轨道面板 / 参数面板」⇒ `toggleMobilePanel("timeline" | "params")`
- 「文件面板 / 记事本」⇒ `wide ? onToggleFiles/onToggleNotebook : toggleMobilePanel(...)`

### ✅ 实测（模拟器）

| 项 | 结果 |
| :--- | :--- |
| 底栏 | `nav` 为 null、页签列表为空 ⇒ **已删除** |
| 视图菜单 | `刷新 / 清除波形缓存 / ─ / ✓轨道面板 / 参数面板 / 文件浏览器 / 记事本 / ─ / ✓剪贴板预览…` |
| 默认勾选 | **只有「轨道面板」带 ✓**（与删底栏前默认页一致） |
| 勾「参数面板」 | `panelSlots: 2`、`hasPianoRoll: true` ⇒ **垂直分屏生效** |
| 截图 | 上「轨道面板」+ 下「参数面板」，底部工具条（∧/撤销/重做/播放）保留 ✅ |

### 🕳️ 本轮最值钱的教训

**改 UI 前先确认"这个界面上到底渲染的是哪个组件"。**
`MenuBar` 与 `MobileTopBar` 是两个平行实现（桌面 vs 手机），
i18n key 也不一样（`file_panel` vs `menu_view_panel_*`）。
我先改了桌面那份，白跑了两轮构建 —— 如果一开始就在手机上用 CDP
查一下"这个菜单项是哪个组件的 DOM"，能直接省掉。

⇒ 判据：**手机上看到的一切都属于 `components/mobile/`**；
`components/layout/` 里的桌面组件（MenuBar / ActionBar / TimelinePanel 等）
在手机上大多不渲染或只渲染一部分。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| C |") or l.startswith("| **C** |")), None)
if old:
    t = t.replace(old,
        "| **C** | **删底栏**（→ 勾选项进「视图」菜单）| ✅ **已完成 + 实测通过**。"
        "① `MobilePanelKey`/`MobilePanels` + `sessionSlice` 的 `mobilePanels`（默认只开 timeline / "
        "`toggleMobilePanel` 含**至少留一个**守卫 / `showMobilePanel` 供 B4 过页）；"
        "② `App.tsx`：单选 `mobileTab` ⇒ 四 boolean + **垂直分屏**，删 `<BottomTabs>`；"
        "③ 🔑 **关键**：手机顶部是 **`MobileTopBar`**（自绘的触摸实现），**`MenuBar` 在手机上不渲染** ⇒ "
        "4 项要加在 `MobileTopBar.menu_view`；并按 `wide` 分流（手机走 `mobilePanels`，平板仍走 "
        "`fileBrowserSlice`/`notebookSlice`）；顺带修掉上游遗留 —— `App.tsx:3966` 的 "
        "`isTablet ? … : undefined` 让手机上那两项**点了没反应**（注释却写着「手机也能开合」）。"
        "**实测**：菜单出现「✓轨道面板/参数面板/文件浏览器/记事本」；勾「参数面板」⇒ "
        "`panelSlots: 2` 且参数面板挂载 ⇒ **分屏生效**；截图确认上轨道下参数、底部工具条保留 ✅ |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：C 标记完成")
else:
    print("· 没找到 C 行")

# 第 6 轮进度表补一行收尾
t = T.read_text(encoding="utf-8")
if "第 6 轮全部完成" not in t:
    anchor = "### E. 交互规格（参照 flm，附件表格）"
    t = t.replace(anchor, """**✅ 第 6 轮 9 项全部交付**（2026-09-25）：
A 组（#7 收尾）· **B1** · **B2** · **B4** · **D1** · **D2** · **D3** · **D4** · **D5** · **C（#17 删底栏）**。
**待办**：**B3**（软件图标糊，需高分辨率源图）；**E 组**（flm 交互规格表，待逐条落地）。

""" + anchor, 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：补第 6 轮总结")
