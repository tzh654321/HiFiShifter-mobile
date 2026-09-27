#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C 收尾：把 4 个面板显隐接到**手机顶栏**（`MobileTopBar`），并解开平板的限制。

## 为什么之前在 `MenuBar.tsx` 加没用

`MobileTopBar.tsx:4` 开头就写着：「桌面 MenuBar 的语义保留（文件/编辑/轨道/视图/选项/帮助）」
—— **手机顶部是 `MobileTopBar` 自绘的一套**，`MenuBar.tsx` 在手机上**根本不渲染**。
我在 `MenuBar` 的 View Menu 里加 4 项，手机自然看不到。

## 拼图的另一半

`MobileTopBar` 的 `menu_view` 里**本来就有**两项：

```
// 侧栏开关（原来只有平板顶栏那两个图标，菜单里也给一份，手机也能开合）
{ label: t("file_panel"), action: onToggleFiles },
{ label: t("notebook"),   action: onToggleNotebook },
```

注释明说「**手机也能开合**」，但 `App.tsx:3966-3967` 传的是

```tsx
onToggleFiles={isTablet ? () => dispatch(toggleFileBrowserVisible()) : undefined}
```

⇒ **手机上拿到 `undefined`，点了没反应**。这是上游遗留的没接完。

## 本轮做法

手机是**单面板**（`mobilePanels`），平板是**侧栏**（`fileBrowserSlice`/`notebookSlice`），
两套语义不同 ⇒ **不改平板的**，只在手机上把 `menu_view` 的四项指到 `mobilePanels`：

- 新增「轨道面板 / 参数面板」两项（`toggleMobilePanel("timeline"|"params")`）
- 把「文件面板 / 记事本」在**手机分支**下也指向 `mobilePanels`（平板仍走原 props）
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

MT = FE / "components" / "mobile" / "MobileTopBar.tsx"
t = MT.read_text(encoding="utf-8")

old = """            { sep: true, label: "" },
            // 侧栏开关（原来只有平板顶栏那两个图标，菜单里也给一份，手机也能开合）
            { label: t("file_panel"), action: onToggleFiles },
            { label: t("notebook"), action: onToggleNotebook },"""
assert t.count(old) == 1, "侧栏开关锚不唯一"

new = """            { sep: true, label: "" },
            /* C（#17）：手机是**单面板**（`mobilePanels`），平板是**侧栏**（fileBrowser/notebook
               两个 slice），两套语义不同 ⇒ 手机分支指向前者。
               ⚠️ 上游这里原本只有 `onToggleFiles` / `onToggleNotebook`，而 App 传的是
               `isTablet ? ... : undefined` ⇒ **手机上点了没反应**（注释却写着"手机也能开合"）。
               现在手机端四项统一走 `toggleMobilePanel`，`toggleMobilePanel` 自带
               「至少留一个」守卫。 */
            { label: t("menu_view_panel_timeline"),
              checked: Boolean(s.mobilePanels?.timeline),
              action: () => dispatch(toggleMobilePanel("timeline")) },
            { label: t("menu_view_panel_params"),
              checked: Boolean(s.mobilePanels?.params),
              action: () => dispatch(toggleMobilePanel("params")) },
            { label: t("menu_view_panel_files"),
              checked: wide
                  ? Boolean(fileBrowserVisible)
                  : Boolean(s.mobilePanels?.files),
              action: wide
                  ? onToggleFiles
                  : () => dispatch(toggleMobilePanel("files")) },
            { label: t("menu_view_panel_notes"),
              checked: wide
                  ? Boolean(notebookVisible)
                  : Boolean(s.mobilePanels?.notes),
              action: wide
                  ? onToggleNotebook
                  : () => dispatch(toggleMobilePanel("notes")) },"""

t = t.replace(old, new, 1)
print("✓ MobileTopBar：menu_view 换成 4 项面板显隐")

# selector 补 mobilePanels
import re
m = re.search(r"(const s = useAppSelector\(\s*\(st\) => \(\{)((?:(?!\}\)\s*,).)*)", t, re.S)
if m and "mobilePanels" not in m.group(2):
    t = t[:m.end(2)] + "\n        mobilePanels: st.session.mobilePanels," + t[m.end(2):]
    print("  ✓ selector 补 mobilePanels")
else:
    print("  · selector 已有或结构不同，需人工确认")

# import toggleMobilePanel
m2 = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if m2 and "toggleMobilePanel" not in m2.group(1):
    t = t[:m2.start()] + f'import {{{m2.group(1).rstrip()}\n    toggleMobilePanel,\n}} from "../../features/session/sessionSlice";' + t[m2.end():]
    print("  ✓ import 补 toggleMobilePanel")
else:
    print("  · import 检查")

# notebookVisible 是否已是 props（C 里要用）
if "notebookVisible" not in t.split("export function MobileTopBar")[0]:
    print("  ⚠️ notebookVisible 可能不在 props 里，需确认")

MT.write_text(t, encoding="utf-8")

# ── 检查 MobileTopBar 的 props 是否已含 notebookVisible / fileBrowserVisible ──
head = t.split("export function MobileTopBar")[0]
for name in ("notebookVisible", "fileBrowserVisible", "wide"):
    print(f"  props 检查 {name}: {'有' if name in head else '⚠️ 缺'}")
print("✓ 完成")
