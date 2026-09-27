#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（音频块头尾控制点）：长按 ⇒ 变速模式（左右两处对称改）。

现状：`ClipEdgeHandles` 里 `trim` / `stretch` 的切换已存在，但入口是**物理 Alt**
（`const stretchActive = altPressed;`）⇒ **触屏上没有 Alt，手机上永远只能 trim**。

改法（左右各一处，结构相同）：
1. `onPointerDown` 起 500ms 定时器 ⇒ 到点 `longPressed = true`（并打 data 标记，供 CSS 出图标）；
2. **把 `mode` 的求值从 onPointerDown 移到 onMove** —— 它原本是闭包常量，
   长按后才决定就晚了；
3. `onEnd`（抬手/取消）清定时器。

⇒ 长按后拖动 = `stretch_*`，与物理 Alt 走**同一条** `startEditDrag`，不新增路径。
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
F = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "timeline" / "clip" / "ClipEdgeHandles.tsx")
t = F.read_text(encoding="utf-8")
n = 0

for side in ("left", "right"):
    # ── ① mode 常量 → 惰性求值 + 长按定时器 ──────────────────────────────
    old = (f'                    const mode = stretchActive ? "stretch_{side}" : "trim_{side}";')
    if t.count(old) != 1:
        print(f"  ⚠️ {side}: mode 行命中 {t.count(old)} 次，跳过")
        continue
    t = t.replace(old, f"""                    /* E 组：**长按 ⇒ 变速模式**（触屏没有 Alt）。
                       原本 mode 在此一次算定（闭包常量），长按后才决定就晚了
                       ⇒ 改为惰性求值，见 `resolveEdgeMode`。 */
                    let edgeLongPressed = false;
                    const edgeTimer = window.setTimeout(() => {{
                        edgeLongPressed = true;
                        targetEl.dataset.hsEdgeLongPress = "1";
                    }}, 500);
                    const clearEdgeTimer = () => {{
                        window.clearTimeout(edgeTimer);
                        delete targetEl.dataset.hsEdgeLongPress;
                    }};
                    const resolveEdgeMode = () =>
                        stretchActive || edgeLongPressed ? "stretch_{side}" : "trim_{side}";""", 1)
    n += 1
    print(f"  ✓ {side}: 加长按状态")

    # ── ② onMove 里用 resolveEdgeMode() ────────────────────────────────
    # 该 side 的 startEditDrag 调用里，第 3 个实参是 mode
    pat = re.compile(
        r"(dragStarted = true;\s*\n\s*startEditDrag\(\s*\n"
        r"(?:\s*\{\s*\n(?:\s*[^\n]*\n)*?\s*\}\s*as unknown as React\.PointerEvent,\s*\n)"
        r"\s*clipId,\s*\n\s*)mode,")
    m = pat.search(t)
    if m:
        t = t[:m.start(1)] + m.group(1).replace("dragStarted = true;", "dragStarted = true;\n                        clearEdgeTimer();") + "resolveEdgeMode()," + t[m.end():]
        n += 1
        print(f"  ✓ {side}: onMove 改用 resolveEdgeMode()")
    else:
        print(f"  ⚠️ {side}: onMove 锚没匹配到（需人工确认）")

F.write_text(t, encoding="utf-8")

# ── ③ onEnd 清定时器（两处）────────────────────────────────────────────
t = F.read_text(encoding="utf-8")
cnt = t.count("const onEnd = (ev: PointerEvent) => {")
t = t.replace("const onEnd = (ev: PointerEvent) => {",
              "const onEnd = (ev: PointerEvent) => {\n                        clearEdgeTimer();")
F.write_text(t, encoding="utf-8")
print(f"  ✓ onEnd 清定时器 × {cnt} 处")
print(f"共 {n} 处")
