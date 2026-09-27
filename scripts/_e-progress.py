#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：v 菜单两点修正 + E 组第一条。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## v 菜单两点修正 + E 组第一条（2026-09-25 深夜）

### 修正一：D1 的 5 个编辑按钮**不进 v 菜单**

**根因**：手机的 ∨ 菜单**不是另写的一套 UI** —— 它只是往 `body` 打
`data-hs-param-menu="open"`，再由 CSS 把参数行整块重排成竖排浮层。
我把 5 个按钮加在 `MobileParamToolRow`（= `.hs-param-toolrow`）上，
**菜单一开它们就跟着冒出来了**。

**做法**：
1. `BarButton` 加 `className` prop（原来只吃固定类名）；
2. 5 个按钮传 `className="hs-edit-btn"`；
3. CSS：

```css
body[data-hs-param-menu="open"] .hs-param-toolrow .hs-edit-btn {
    display: none !important;   /* ⚠️ 必须 important */
}
```

🔴 **`!important` 不是偷懒**：`BarButton` 的 `display: "flex"` 是**内联样式**，
优先级高于任何类选择器 —— 第一版没加，实测 `getComputedStyle` 仍是 `flex`、按钮照旧显示。

**✅ 实测**：`menuOpen: "open"` 且 5 个按钮全部 `display: "none"`。

### 修正二：`↘MID` 的位置本来就对

排列是 **🔒 锁 → 参考轨道组 → 导入 MIDI**（`PianoRollPanel` L6901 / L7068 附近），
即用户说的"锁的右边"。B2 只把它从**文字 Button**（宽 43、装不下"导入 MIDI"
被压成两行）换成 `IconButton` + `MidiIcon`，**位置没动**。

### E 组第一条：拍数栏**双击 = 移动进度条并开始播放**

两处都加了：

| 位置 | 组件 | 做法 |
| :--- | :--- | :--- |
| 参数编辑器 | `timeline/TimeRuler.tsx` | 新增 `onDoubleClick?: () => void` prop，挂到 `Box` 上 |
| 时间线 | `TimelinePanel.tsx` | 命令式：`rulerEl.addEventListener("dblclick", ...)` |

**语义**：单击的 seek 已经由各自路径完成（双击本身会先触发一次 pointerdown），
所以回调里**只负责起播**，且**仅在未播放时**（`!st.runtime.isPlaying`）——
免得双击把正在播放的曲子停掉。

🕳️ **两个字段名坑**：
- 播放状态在 **`session.runtime.isPlaying`**（不是 `session.isPlaying`）；
- 播放/停止是 **`playOriginal()` / `stopAudioPlayback()`**
  （见 `MobileBottomBar.tsx:1063`）。

🕳️ **组件名坑**：参数编辑器里有两个"标尺行"，容易混 ——
**`TimeRuler`**（时间标尺，拍数栏）与 **`TempoMapRulerRow`**（Tempo Map 标尺行）。
我一开始改错了后者。

⚠️ **未验证**：双击起播只过了 tsc，**没做运行时验证**（时间太晚，
且 CDP 要点准拍数栏比较麻烦）。**留待真机确认。**
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
if "E 组第一条" not in t:
    anchor = "**待办**：**B3**（软件图标糊，需高分辨率源图）；**E 组**（flm 交互规格表，待逐条落地）。"
    t = t.replace(anchor, anchor + """

**E 组进展（2026-09-25 深夜）**：

| 交互（flm 表）| 状态 |
| :--- | :--- |
| **拍数栏双击 = 移动进度条并开始播放** | 🟡 代码已加（`TimeRuler` 加 prop + `TimelinePanel` 加 `dblclick` 监听），tsc 过；**待运行时验证**。语义：单击 seek 已有，回调只负责「未播放时起播」，不打断正在播放的 |
| 其余 20+ 条（单击/划动/长按/长按并划动/双指单击 × 4 区域）| ⏳ 待逐条落地 |

**v 菜单两点修正**：① D1 的 5 个编辑按钮**不进 v 菜单** —— 已在 `.hs-param-toolrow`
上加 `data-hs-param-menu="open"` 时隐藏 `.hs-edit-btn`（**必须 `!important`**，
因为 `BarButton` 的 `display` 是内联样式）；实测 5 个按钮 `display: none` ✅。
② `↘MID` 位置本就正确（🔒 锁 → 参考轨道组 → 导入 MIDI），B2 只换了图标未动位置。""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：记录 E 组进展与两点修正")
