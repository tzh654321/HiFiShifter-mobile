#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组最后一条可做的：**长按控制点后「上划」= 调整淡入/淡出时长**。

规格（flm 交互表 · 音频块头尾的控制点 · 长按并划动）：

> **上划=调整淡入淡出时长**；下划=横滑调整变速缩放（相当于 Alt 拖动块边缘）

## 好消息：`fade_in` / `fade_out` 也是 `EditDragType`

`useEditDrag.ts:173` 的 `EditDragType` 里本来就有：

```ts
| "fade_in"
| "fade_out"
```

⇒ 与 `stretch_left` / `stretch_right` **完全同一个入口**（`startEditDrag`），
不用新写逻辑，只要在 `onMove` 里按**主导方向**选 type：

- 长按后 **纵向主导**（`|dy| > |dx|`）⇒ `fade_in`（左边缘）/ `fade_out`（右边缘）
- 长按后 **横向主导** ⇒ `stretch_*`（变速，上一步已做）
- 没长按 ⇒ `trim_*`（原行为）

⇒ 一个 `resolveEdgeDragType(dx, dy)` 把三种情形收干净。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "timeline" / "clip" / "ClipEdgeHandles.tsx")
t = F.read_text(encoding="utf-8")
n = 0

for side in ("left", "right"):
    old = (f"""                    const resolveEdgeMode = () =>
                        stretchActive || edgeLongPressed ? "stretch_{side}" : "trim_{side}";""")
    if t.count(old) != 1:
        print(f"  ⚠️ {side}: resolveEdgeMode 锚命中 {t.count(old)} 次")
        continue
    t = t.replace(old, f"""                    /**
                     * 长按后按**主导方向**选拖拽类型（规格：上划调淡入淡出、横滑调变速）：
                     * - 纵向主导 ⇒ `fade_{"in" if side == "left" else "out"}`（调该侧淡入/淡出时长）
                     * - 横向主导 ⇒ `stretch_{side}`（变速，相当于 Alt 拖动块边缘）
                     * - 未长按   ⇒ `trim_{side}`（原行为：裁短/延长）
                     */
                    const resolveEdgeDragType = (dx: number, dy: number) => {{
                        if (!edgeLongPressed) {{
                            return stretchActive ? "stretch_{side}" : "trim_{side}";
                        }}
                        return Math.abs(dy) > Math.abs(dx) ? "fade_{"in" if side == "left" else "out"}" : "stretch_{side}";
                    }};""", 1)
    n += 1
    print(f"  ✓ {side}: resolveEdgeMode → resolveEdgeDragType")

# onMove 调用处：把 resolveEdgeMode() 换成 resolveEdgeDragType(dx, dy)
# —— onMove 里已经有 dx/dy 局部量
cnt = t.count("resolveEdgeMode(),")
t = t.replace("resolveEdgeMode(),", "resolveEdgeDragType(dx, dy),")
n += cnt
print(f"  ✓ onMove 调用点 × {cnt}")

F.write_text(t, encoding="utf-8")
print(f"共 {n} 处")
