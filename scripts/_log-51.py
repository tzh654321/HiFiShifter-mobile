#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#51 / #10：确认电脑版「音频块范围加入参数选区」的正确操作方法。

用户在电脑版 beta14 试了「按住右键单击音频块」，**没出现**该功能。
读源码后确认：**触发方式不是"按住右键"，而是普通右键 / 菜单 / 快捷键三种**，
而且**必须先打开参数编辑器**才有效果。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #51 / #10 查清了「音频块范围加入参数选区」的正确用法（03:20-03:40）

用户在电脑版 beta14 试了「**按住右键**单击音频块」——**没有出现**该功能。
读源码后确认：**触发方式根本不是"按住右键"**。

### 电脑版有三种入口（都在 beta14 里）

| 入口 | 位置 | 依据 |
| :--- | :--- | :--- |
| **快捷键** | **`Ctrl + Shift + A`** | `features/keybindings/defaultKeybindings.ts:48` → `"edit.addClipsToParamSelection": { key: "a", ctrl: true, shift: true }` |
| **「编辑」菜单** | 菜单里一项，右侧带快捷键提示 | `MenuBar.tsx:792` |
| **音频块右键菜单** | 菜单**最下方**（`<Divider />` 之后）| `ClipContextMenu.tsx:870-875`，标签 `ctx_add_to_param_selection` |

⇒ 用户要找的是**第 3 种**（右键菜单），大概是因为：菜单项在**最底部**、
而且**只在右键点在"音频块"上**时才出现（点空白处没有该菜单）。

### 🔴 更关键：**必须先打开参数编辑器**，否则点了"没反应"

消费侧 `PianoRollPanel.tsx:5295-5316`：

```ts
if (op === "addClipsToParamSelection") {
    for (const id of requestedIds) {
        const clip = session.clips.find(...);
        if (resolveRootTrackId(session.tracks, clip.trackId) !== rootTrackId) continue;
        ranges.push({...});
    }
    if (ranges.length === 0) return;     // ← 静默返回
    ...
}
```

- **只取「当前参数编辑器所属根轨道组」内的块**；
- 跨轨道的块被**静默忽略**；
- **参数编辑器没打开时 `rootTrackId` 不匹配 ⇒ 全部 continue ⇒ `ranges` 为空 ⇒ 直接 return**
  ⇒ 表现就是「点了完全没反应」。

### 给用户的操作步骤

1. **先打开参数编辑器**（钢琴卷帘那个面板）；
2. **右键点某个音频块**（在它本体上右键，不是按住不放）⇒ 菜单**最下面**有
   「音频块范围加入参数选区」（或直接按 **Ctrl+Shift+A**，此时不用右键）；
3. ⚠️ 该音频块必须与参数编辑器**同根轨道**，否则会被静默忽略。

⇒ **手机端适配建议**（等用户确认后定）：长按音频块的菜单里补这一项 +
在「编辑」菜单里也放一项，并在参数编辑器未打开时**给出提示**而不是静默失败。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### 🔍 #10 查证结论（2026-09-27 03:40）—— **触发方式不是「按住右键」**

| 入口 | 位置 | 依据 |
| :--- | :--- | :--- |
| **快捷键** | **`Ctrl + Shift + A`** | `defaultKeybindings.ts:48` |
| **「编辑」菜单** | 一项，右侧带快捷键提示 | `MenuBar.tsx:792` |
| **音频块右键菜单** | **最下方**（分隔线之后）| `ClipContextMenu.tsx:870-875` |

🔴 **而且必须先打开参数编辑器**：消费侧 `PianoRollPanel.tsx:5295-5316` 会
`if (resolveRootTrackId(trackId) !== rootTrackId) continue;` ⇒
**参数编辑器没打开时所有块都不匹配 ⇒ `ranges.length === 0` ⇒ 静默 return** ⇒
表现就是「点了没反应」。跨根轨道的块也会被静默忽略。

**请用户按此复验**（开参数编辑器 → 右键音频块 → 菜单最下方 / 或 Ctrl+Shift+A）。
手机端适配方案待用户确认后再定（候选：长按菜单补该项 + 编辑菜单也放 + 未开编辑器时给提示）。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
