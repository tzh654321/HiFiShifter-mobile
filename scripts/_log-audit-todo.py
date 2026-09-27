#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对待办：哪些已过期。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### 🔍 待办核对（2026-09-27 08:35）—— 找出**过期条目**

| 原待办 | 核对结果 |
| :--- | :--- |
| **#1 参数面板拍数栏点击不 seek** | ✅ **已修，待办过期** —— `usePianoRollInteractions.ts:1528` 注释写明 **2026-09-25 修（#D3）**：原来用 `isLegacyMouseEventFromStylus()`（**对 touch 也返回 true**）⇒ 改成只拦 `pen`。真机 bundle 实测 `has_pen_only_guard: true`。**这条不该再排在待办里。** |
| **#4 移动端 i18n** | 🟡 **部分完成** —— 实测硬编码中文：`MobileBottomBar` **14 处**、`MobileTopBar` **7 处**、`BottomTabs` **0 处**（原来记的 58 处已大幅减少，说明改过一轮）。**剩 21 处待收尾。** |
| **#9 setup 资源拷贝顺序** | 待核实（`lib.rs:353-355` 有 `ensure_background_prewarm()`） |

⚠️ **教训**：待办列表本身需要**定期核对是否过期** —— #1 挂在列表里好几天，
实际早在 09-25 就修完了。**光看列表不看代码，会重复劳动。**
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

## 🔍 待办核对：发现过期条目（08:35）

### #1「参数面板拍数栏点击不 seek」→ **早已修好，待办过期**

`usePianoRollInteractions.ts:1528` 的注释写得很清楚：

> 🔴 2026-09-25 修（TASKS #D3）：原来这里是 `isLegacyMouseEventFromStylus()`，
> 而它在 `penInput.ts:209` 对 **touch 也返回 true** ⇒ 手机上点拍数栏**完全没反应**
> （参数编辑器没有时间线那套 pointer 专用路径）。现在只拦 pen。

⇒ 修法是**放宽守卫**（不是新加 pointer 路径）：

```js
// 错（对 touch 也 true）：
if (isLegacyMouseEventFromStylus()) return;
// 对：
if (pointerKindOf(lastRealPointerType()) === "pen") return;
```

真机 bundle 实测 `has_pen_only_guard: true` ⇒ 确认在生效。

⚠️ **这条在 MEMORY.md 的待办里挂了 5 天**（我从 09-22 的记录抄过来，一直没核）。
⇒ **教训：待办列表要和代码对账**，不能只继承上一版列表。已从待办移除。

### #4 移动端 i18n → 部分完成

实测硬编码中文：`MobileBottomBar` **14** 处、`MobileTopBar` **7** 处、`BottomTabs` **0** 处。
（旧记录说 58 处 ⇒ 说明中间改过一轮。）**剩 21 处待收尾。**
""", encoding="utf-8")
print("✓ memory 已追加")
