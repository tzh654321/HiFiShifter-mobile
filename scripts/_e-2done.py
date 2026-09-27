#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组进度：第 2 条（轨道头左划隐藏）完成。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 2 条：轨道头**左划 = 隐藏/展开轨道头**（实测通过）

规格（flm 交互表，**轨道头**这一列）里只缺这一条 ——
单击切换轨道 ✅ / 上下划平移 ✅ / 长按轨道菜单 ✅ / 长按并划动换序 ✅ 都已存在。

### 做法：不碰布局代码

轨道头列的滚动容器**已有 `data-track-list-panel` 属性** ⇒
用「`body` 打标 + CSS 折叠」，不动任何布局计算：

```css
body[data-hs-header-collapsed="1"] [data-track-list-panel] { display: none; }
```

⚠️ 状态放 **DOM 属性**而不是 redux —— 纯展示开关、没有别处要读。
（以后若要在菜单里暴露，再提升到 redux。）

### 左划怎么判（关键：不能抢竖向滚动）

轨道列**本身是原生竖向滚动容器**（`attachSurface(el, "y")`），
抢它的单指手势会让「单指滚轨道」失效。所以只加一层**极轻的横向判定**：

- `pointerdown` 记起点；
- `pointermove` 里 **横向 ≤ -48px 且 纵向 < 24px**（明确左划）才触发；
- 触发后 `swipeFired = true` 不再重复，直到抬手；
- `pointerType === "mouse"` 直接跳过（鼠标留给别的交互）。

### ✅ 实测（模拟器 CDP 合成 touch 指针）

```
轨道列宽 131px
→ 左划 8 步（每步 -12px）
→ body[data-hs-header-collapsed="1"]
→ [data-track-list-panel] display: none     ✅
```

### 🕳️ 记一笔：`getPxPerSec` 那条路走不通

拍数栏的「长按出现变速缩放图标 + 下划调整变速」我试着做过，**放弃了**：
`TimelineKernelHost` 的接口很小（`invalidateScene` / `paintNow`），
没有暴露 `getPxPerSec` / `setHorizontal` 这类；横向缩放的真值在
`ScrollKernel` 里，要从 TimelinePanel 够到它得先扩接口 ——
**那是个正经的设计改动，不该在深夜顺手做**。留待专门一轮。

⇒ 教训：**E 组里"能顺手做"和"要先扩接口"的门槛差别很大**；
动手前先确认目标能力的入口在不在手边（`grep` 一次就知道），
比写到一半发现没有入口再退回来省事。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "**E 组进展（2026-09-25 深夜）**："
if old in t:
    t = t.replace(old, """**E 组进展（2 / 21）**：""", 1)
old2 = "| 其余 20+ 条（单击/划动/长按/长按并划动/双指单击 × 4 区域）| ⏳ 待逐条落地 |"
if old2 in t:
    t = t.replace(old2, """| **轨道头左划 = 隐藏/展开轨道头** | ✅ **已完成 + 实测通过**。轨道头列的滚动容器已有 `data-track-list-panel` ⇒ 用 `body[data-hs-header-collapsed="1"] [data-track-list-panel] { display:none }` **折叠，不碰布局代码**；左划判定挂在 `trackListEl` 上（**横向 ≤ -48px 且纵向 < 24px** 才算，避免抢走「单指滚轨道」）。实测：左划后 `collapsed=1`、`display: none` ✅ |
| 其余条目（单击/划动/长按/长按并划动/双指单击 × 4 区域）| ⏳ 待逐条落地 |

⚠️ **拍数栏「长按出变速图标 + 下划调整变速」暂缓**：`TimelineKernelHost` 没暴露
`getPxPerSec` / `setHorizontal`，横向缩放真值在 `ScrollKernel` 里，
要先扩接口 —— 属**设计改动**，不该深夜顺手做。留专门一轮。""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组进度更新（2/21）")
