#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #49：顶栏「轨道」菜单对齐长按轨道头。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #49 顶栏「轨道」菜单对齐长按轨道头（03:04-04:25）

### 对比（两边都读了源码）

| 长按轨道头 `TrackList.tsx:2269+` | 顶栏 `MobileTopBar.tsx:332` 原有 |
| :--- | :--- |
| `track_add` 添加轨道 | ✅ |
| `track_clone` 克隆 | ✅ 但显示 "克隆选中轨道" |
| `ctx_delete` 删除 | ✅ 但显示 "删除选中轨道" |
| **`ctx_rename` 重命名** | ❌ **缺** |
| **算法子菜单**（world / nsf-hifigan / vslib / 无）| ❌ **缺** |

### 修法

1. 标签与长按菜单统一（`track_clone` / `ctx_delete`）；
2. 加**重命名**：
   - 落库是 `TimelinePanel:5559` 的 `handleTrackNameChange`
     = `dispatch(setTrackName) + setTrackStateRemote({name})`；
   - **但「进入行内编辑态」是 `TrackList` 的局部 state**（`setEditingTrackId`），
     顶栏够不着 ⇒ **派发 `hs-rename-track` 事件**，`TrackList` 加监听接住
     （沿用本文件既有的 `hs-mobile-switch-tab` 事件桥模式）。
3. 加**算法**：直接调 `TimelinePanel:5548` 用的**同一个 thunk**
   `setTrackStateRemote({ trackId, pitchAnalysisAlgo })`。
   ⚠️ 这个 thunk 在 **`trackThunks.ts`**，**不在** `timelineThunks.ts`
   （我第一次 import 错了地方，tsc 报 `has no exported member`）。
4. **算法做成 `sub` 二级面板** —— `MenuEntry` **没有 `isHeader`**
   （只有 label / action / sep / checked / sub），平铺 4 行会把一级菜单撑太长。

⚠️ **算法的显示条件与长按菜单一致**：**根轨 + 已开 Compose**
（判据抄 `TrackList` 的 `ctxIsRoot` / `ctxComposeEnabled`）⇒
当前默认轨没开 Compose，所以菜单里**看不到算法项**，这是**正确行为**。

### 验证（模拟器）

```
menuLeft: 105              ← 左对齐（#42 未回归）
items: 添加轨道 / 克隆轨道 / 删除 / 重命名
```

截图 `0100` 确认分隔线位置也对（重命名在分隔线之后，与长按菜单同款）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #49 顶栏「轨道」菜单对齐长按轨道头（2026-09-27 04:25）

| 项 | 长按轨道头 | 顶栏原有 | 现在 |
| :--- | :--- | :--- | :--- |
| 添加轨道 | ✅ | ✅ | ✅ |
| 克隆 | ✅ | ✅（文案不同）| ✅ **文案已统一** |
| 删除 | ✅ | ✅（文案不同）| ✅ **文案已统一** |
| **重命名** | ✅ | ❌ | ✅ **已补** |
| **算法** | ✅ | ❌ | ✅ **已补（sub 二级面板）** |

- **重命名**：落库走 `setTrackName + setTrackStateRemote`；「进入行内编辑态」是
  `TrackList` 的局部 state ⇒ 顶栏派 `hs-rename-track` 事件，`TrackList` 监听接住。
- **算法**：直接调 `setTrackStateRemote({ trackId, pitchAnalysisAlgo })`。
  ⚠️ 该 thunk 在 **`trackThunks.ts`**（不在 `timelineThunks.ts`）。
- ⚠️ **算法项只在「根轨 + 已开 Compose」时出现** —— 与长按菜单判据一致，
  当前默认轨没开 Compose，所以看不到，**这是正确行为**。
- ✅ 实测：`items = 添加轨道 / 克隆轨道 / 删除 / 重命名`，且 `menuLeft=105`（#42 未回归）。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
