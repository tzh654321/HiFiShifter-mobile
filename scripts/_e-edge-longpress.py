#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（音频块头尾控制点）：**长按 ⇒ 变速缩放模式**（显示图标），
长按后拖动 ⇒ 走 `stretch_*`（相当于 Alt 拖动块边缘）。

规格（flm 交互表 · 音频块头尾的控制点）：

| 手势 | 行为 |
| :--- | :--- |
| 长按 | **其上方出现淡入/淡出图标，下方出现变速缩放图标** |
| 长按并划动 | 上划=调整淡入淡出时长；**下划=横滑调整变速缩放（相当于 Alt 拖动块边缘）** |

## 现状

`ClipEdgeHandles` 里 `trim` / `stretch` 的切换**已经存在**，只是入口是**物理 Alt**：

```ts
const stretchActive = altPressed;
const mode = stretchActive ? "stretch_left" : "trim_left";
```

⇒ 触屏上没有 Alt ⇒ **手机上永远只能 trim**。

## 做法：把「长按」加成第二个 stretch 入口

1. `onPointerDown` 起 500ms 定时器 ⇒ 到点 `longPressed = true` + 显示图标；
2. **把 `mode` 的求值从 `onPointerDown` 移到 `onMove`** ——
   原来是闭包常量，长按后才决定就晚了；
3. `onMove` 提交时用 `altPressed || longPressed`。

⇒ 这样"长按后拖动 = 变速"，与物理 Alt 走**完全同一条** `startEditDrag(..., "stretch_*")`，
不新增代码路径。

⚠️ 图标：先用一个极简的**文字气泡**（"变速"）贴在控制点旁，形状与位置后续再打磨。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
F = FE / "components" / "layout" / "timeline" / "clip" / "ClipEdgeHandles.tsx"
t = F.read_text(encoding="utf-8")
n = 0

# ── 左边缘 ──────────────────────────────────────────────────────────────────
old_left = """                    const startX = e.clientX;
                    const startY = e.clientY;
                    const pointerId = e.pointerId;
                    const targetEl = e.currentTarget as HTMLElement;
                    const mode = stretchActive ? "stretch_left" : "trim_left";"""
assert t.count(old_left) == 1, "左边缘锚不唯一"
t = t.replace(old_left, """                    const startX = e.clientX;
                    const startY = e.clientY;
                    const pointerId = e.pointerId;
                    const targetEl = e.currentTarget as HTMLElement;
                    /* E 组：**长按 ⇒ 变速模式**（触屏没有 Alt）。
                       原本 `mode` 在这里一次算定（闭包常量），长按后才决定就晚了
                       ⇒ 求值移到 `onMove`。 */
                    let edgeLongPressed = false;
                    const edgeTimer = window.setTimeout(() => {
                        edgeLongPressed = true;
                        targetEl.dataset.hsEdgeLongPress = "1";
                    }, 500);
                    const clearEdgeTimer = () => {
                        window.clearTimeout(edgeTimer);
                        delete targetEl.dataset.hsEdgeLongPress;
                    };
                    const resolveEdgeMode = () =>
                        stretchActive || edgeLongPressed ? "stretch_left" : "trim_left";""", 1)
n += 1
print("✓ 左边缘：加长按状态")

# onMove 里改用 resolveEdgeMode()
old_move_l = """                        dragStarted = true;
                        startEditDrag(
                            {
                                button: 0,
                                pointerId,
                                currentTarget: targetEl,
                            } as unknown as React.PointerEvent,
                            clipId,
                            mode,
                        );"""
assert t.count(old_move_l) >= 1, "onMove 锚找不到"
t = t.replace(old_move_l, """                        dragStarted = true;
                        clearEdgeTimer();
                        startEditDrag(
                            {
                                button: 0,
                                pointerId,
                                currentTarget: targetEl,
                            } as unknown as React.PointerEvent,
                            clipId,
                            resolveEdgeMode(),
                        );""", 1)
n += 1
print("✓ left onMove：改用 resolveEdgeMode()")

# 抬手时清定时器
old_cleanup = """                        dragStarted = true;
                        clearEdgeTimer();"""
t = t.replace("""                    const onUp = (ev: PointerEvent) => {""",
              """                    const onUp = (ev: PointerEvent) => {
                        clearEdgeTimer();""", 1)
n += 1
print("✓ left onUp：清定时器")

F.write_text(t, encoding="utf-8")
print(f"共 {n} 处（左边缘）。右边缘同样处理见下一步。")
