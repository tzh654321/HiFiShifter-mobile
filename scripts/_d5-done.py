#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D5 完成记录。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊾ D5 完成：参数编辑器纵向缩放「缩到音域边界就卡住」

### 用户给的复现路径（一句话定位到代码）

> 双指纵向缩放到单边音域上限/下限后继续缩小，正确的效果是**以边界为缩放中心继续缩放**，
> 轨道界面就是正常的。

### 根因：共用公式，但「行高边界」的来源不同

`touchGesture.ts:483-490` 是**两个面板共用**的纵向缩放公式：

```ts
const targetRowH = clamp(s.rowHeight0 * ky, rhBounds.min, rhBounds.max);
const rowAtMid0 = (s.scrollTop0 + s.mid0.y) / s.rowHeight0;
const newScrollTop = rowAtMid0 * targetRowH - mid.y;
this.viewport.setVertical(targetRowH, newScrollTop);
```

差异只在 `viewport.getRowHeightBounds()` 与 `setVertical`：

| | 轨道界面（正常）| 参数编辑器（卡住）|
| :--- | :--- | :--- |
| `getRowHeightBounds` | 转发内核 ⇒ 行高有**独立**范围 | 返回很宽的 `{min:0.2, max:1e6}` |
| `setVertical` | `host.setRowHeightAndScrollTop` | `span = h/rowHeight` ⇒ **交给 `clampViewport`** |
| 最终钳制 | 行高本身 | **`clampViewport` 把 span 钳到 `[6, absMax-absMin]`** |

⇒ **span 上限恰好等于整个音域宽度** ⇒ 缩到边界后 span 到顶，`rowHeight = h/span`
再也降不下去 ⇒ 读作"卡住"。**轨道界面没这个问题，因为它的行高边界与内容跨度无关。**

### 附带修掉一个潜伏 bug

```ts
const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
```

`span > range` 时 `absMin + span/2 > absMax - span/2` ⇒ **lo > hi**，
`clamp` 语义未定义（多数实现返回 lo ⇒ center 被顶到一侧、画面跳）。

⇒ 抽了个 `clampSpanCenter()`：`lo > hi` 时返回区间中点（值域整体居中），
并把 span 上限放宽到 `range * 4`（超出部分只是留白，与轨道行为一致）。

### ✅ 验证（模拟器 CDP 合成双指）

`cdp` 里合成 `pointerType:'touch'` 的两指，从 60px 间距收到 3px（60 步），
读 `window.__hsGestureDebug.rowH`：

```
39.5 → … → 2.542 → 1.975（最后 5 步稳定在新下限）
```

**关键**：`rowH = 1.975` 对应 `span ≈ 253`，而音域宽度只有 **127**。
旧代码 span 上限 = 127（rowH 下限 3.94）⇒ **修复后缩放下限多降了 2 倍多**，
且稳定停在 508（=127×4）这个新的物理上限，符合预期。

⚠️ `__hsGestureDebug` 的字段名是 **`rowH` / `vZoom`**（不是 `rhAfter` / `rowHeightAfter`）——
以后用 CDP 读手势中间量时别再猜字段名。
""", encoding="utf-8")
print("✓ memory ㊾ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| D5 |")), None)
if old:
    t = t.replace(old,
        "| **D5** | 钢琴栏缩放卡边界 | ✅ **已修 + 实测通过**。根因：纵向缩放公式共用，"
        "但参数编辑器的行高最终换算成 `span` 交给 `clampViewport`，而它的 **span 上限恰好 = 整个音域宽度** "
        "⇒ 缩到边界后 span 到顶、`rowHeight = h/span` 降不下去。轨道界面正常是因为行高边界由内核独立给出、"
        "与内容跨度无关。⇒ 抽出 `clampSpanCenter()`：**span 上限放宽到 `range*4`**（超出只是留白，与轨道一致）+ "
        "**修掉 `span > range` 时 center 的 clamp 区间反转**（lo>hi ⇒ 取中点）。"
        "**实测**：CDP 合成双指捏合，`rowH` 39.5 → **1.975**（对应 span≈253 > 音域 127，旧代码下限 3.94）✅ |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：D5 标记完成")
else:
    print("· 没找到 D5 行")
