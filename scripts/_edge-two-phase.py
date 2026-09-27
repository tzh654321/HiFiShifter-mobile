#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""控制点手势改成**两段式 + 锁定**（对齐 `docs/临时.xlsx` 原始规格）。

## 规格原文（音频块头尾的控制点 · 长按并划动）

> **上划后再横滑**调整淡入淡出时长（相当于电脑版划动音频块上边角）；
> **下划后再横滑**调整变速缩放（相当于按 Alt 拖动块边缘）

⇒ 三个要点，我之前只做到了半个：

1. **上划 ⇒ 淡入淡出；下划 ⇒ 变速**（方向**各有语义**，不是"纵向 vs 横向"的二分）；
2. **先划（定型）再横滑（调节）** —— 两段式；
3. 一旦定型，**后续方向不再翻转**（锁定），否则"上划一点点再纯横向拖"会翻回变速。

## 改动

`ClipEdgeHandles` 里加一个 `lockedKind`：

- `null` ⇒ 尚未定型；
- 长按后纵向位移超过阈值 ⇒ 按**方向**锁定 `"fade"`（上划）或 `"stretch"`（下划）；
- 锁定后 `startEditDrag` 的 type 由 `lockedKind` 决定，不再看即时方向。

⚠️ 未长按时维持原行为（`trim_*`，或 Alt 时 `stretch_*`）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "timeline" / "clip" / "ClipEdgeHandles.tsx")
t = F.read_text(encoding="utf-8")
n = 0

for side in ("left", "right"):
    fade = "fade_in" if side == "left" else "fade_out"

    old = f"""                    /**
                     * 长按后按**主导方向**选拖拽类型（规格：上划调淡入淡出、横滑调变速）：
                     * - 纵向主导 ⇒ `{fade}`（调该侧淡入/淡出时长）
                     * - 横向主导 ⇒ `stretch_{side}`（变速，相当于 Alt 拖动块边缘）
                     * - 未长按   ⇒ `trim_{side}`（原行为：裁短/延长）
                     */
                    const resolveEdgeDragType = (dx: number, dy: number) => {{
                        if (!edgeLongPressed) {{
                            return stretchActive ? "stretch_{side}" : "trim_{side}";
                        }}
                        return Math.abs(dy) > Math.abs(dx) ? "{fade}" : "stretch_{side}";
                    }};"""

    assert t.count(old) == 1, f"{side}: resolveEdgeDragType 锚命中 {t.count(old)} 次"

    new = f"""                    /**
                     * 控制点的拖拽类型（对齐 `docs/临时.xlsx` 原始规格）。
                     *
                     * 规格：**上划后再横滑**调整淡入淡出时长；**下划后再横滑**调整变速缩放
                     * ⇒ **两段式**：先按纵向方向**定型**，之后横滑只是调节量，
                     * **本次拖拽内不再改类型**（否则"上划一点点再纯横滑"会翻回变速）。
                     *
                     * - 未长按        ⇒ `trim_{side}`（原行为；物理 Alt 时 `stretch_{side}`）
                     * - 长按 + 上划   ⇒ `{fade}`
                     * - 长按 + 下划   ⇒ `stretch_{side}`
                     */
                    let lockedKind: "fade" | "stretch" | null = null;
                    const resolveEdgeDragType = (dx: number, dy: number) => {{
                        if (!edgeLongPressed) {{
                            return stretchActive ? "stretch_{side}" : "trim_{side}";
                        }}
                        if (lockedKind === null && Math.abs(dy) >= 8) {{
                            // 上划 = 淡入淡出；下划 = 变速。
                            lockedKind = dy < 0 ? "fade" : "stretch";
                        }}
                        return lockedKind === "fade" ? "{fade}" : "stretch_{side}";
                    }};"""

    t = t.replace(old, new, 1)
    n += 1
    print(f"  ✓ {side}: 两段式 + 锁定")

F.write_text(t, encoding="utf-8")
print(f"共 {n} 处")
