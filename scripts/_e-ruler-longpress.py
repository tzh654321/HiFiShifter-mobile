#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（拍数栏列）：**长按 ⇒ 出现变速缩放图标；长按后下划 ⇒ 调整变速**。

规格（flm 交互表，拍数栏这一列）：

| 手势 | 行为 |
| :--- | :--- |
| 单击 | 移动进度条 ✅ 已有 |
| 双击 | 移动进度条并开始播放 ✅ 已做 |
| 划动 | 左右划平移 ✅ 已有 |
| **长按** | **出现变速缩放图标** ← 本步 |
| **长按并划动** | **下划 = 调整变速**（上划不是淡入淡出）← 本步 |
| 双指单击 | （待定）|

## 改动点

`bindRulerTouchSeek` 里的状态机（`mode`）目前只有 `undecided` / `pan`，
加两个：`armed`（长按已触发、等手指动）与 `zoom`（正在调变速）。

- `onDown`：起 500ms 定时器 ⇒ 到点进 `armed` + 显示图标；
- `onMove`：`armed`/`zoom` 下按纵向位移调 `pxPerSec`（**横向位移不参与**，与"下划"口径一致）；
- `onUp`：清定时器、收图标；
- `pan` 判定前先看是否已 `armed`（长按过就不该再判成平移）。

## 变速怎么写

水平缩放的真值是 `pxPerSec`，入口 `kernelHostRef.current.setHorizontal(pxPerSec, scrollLeft)`。
缩放时**锚定手指所在的秒**，这样画面不会乱跑：
`secAtFinger = (scrollLeft + x) / pxPerSec` ⇒ 缩放后 `scrollLeft = secAtFinger * nextPx - x`。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

# ── ① 在 bindRulerTouchSeek 里加长按状态 ────────────────────────────────────
old = """                const onMove = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    if (gestureActive()) {
                        // 第二指落下 → 整段让给控制器。
                        activeId = null;
                        mode = "undecided";
                        return;
                    }
                    const dx = e.clientX - startX;
                    if (mode === "undecided") {
                        if (Math.abs(dx) < PAN_THRESHOLD) return; // 还没判定，先什么都不做
                        mode = "pan";
                    }
                    e.preventDefault();
                    // 平移量 = 手指位移的反向（内容跟着手指走），钳制交给 ScrollKernel。
                    kernelHostRef.current?.setScrollLeft(startScrollLeft - dx);
                };
                const onUp = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    activeId = null;
                    if (mode === "undecided") {
                        // 没超过阈值 = 点击 ⇒ 拖时间线。
                        seekAt(e.clientX, true);
                    }
                    mode = "undecided";
                };
                const onCancel = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    activeId = null;
                    mode = "undecided";
                };"""

assert t.count(old) == 1, "onMove/onUp 锚不唯一"

new = """                /**
                 * E 组（拍数栏列）：长按 500ms ⇒ 进入「变速缩放」。
                 *
                 * 规格：**长按**出现变速缩放图标；**长按后下划**调整变速。
                 * ⇒ 在原本的 `undecided / pan` 之外加 `armed`（长按已达、等手指动）
                 *   与 `zoom`（正在调变速）。
                 */
                const LONG_PRESS_MS = 500;
                const armLongPress = () => {
                    if (mode !== "undecided") return;
                    mode = "armed";
                    startZoomPx = kernelHostRef.current?.getPxPerSec() ?? startPxPerSec;
                    startZoomY = lastY;
                    setRulerZoomHint({ visible: true, pxPerSec: startZoomPx, y: lastY });
                };
                /** 变速浮层：显示当前 px/s，随手指纵向移动更新。 */
                const applyZoomFromY = (dy: number) => {
                    // 下划（dy>0）⇒ 变快（放大 pxPerSec）；上划 ⇒ 变慢。指数映射手感均匀。
                    const next = clamp(startZoomPx * Math.pow(1.006, dy), 2, 4000);
                    const host = kernelHostRef.current;
                    if (host) {
                        // 锚定手指所在秒，避免缩放时画面乱跑。
                        const x = startX;
                        const secAtFinger = (startScrollLeft + x) / startZoomPx;
                        host.setHorizontal(next, secAtFinger * next - x);
                    }
                    setRulerZoomHint({ visible: true, pxPerSec: next, y: lastY });
                };

                const onMove = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    if (gestureActive()) {
                        // 第二指落下 → 整段让给控制器（长按中的变速也要让位）。
                        if (mode === "armed" || mode === "zoom") setRulerZoomHint(null);
                        activeId = null;
                        mode = "undecided";
                        return;
                    }
                    lastY = e.clientY;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    if (mode === "undecided") {
                        if (Math.abs(dx) < PAN_THRESHOLD) return; // 还没判定，先什么都不做
                        mode = "pan";
                    }
                    if (mode === "armed") {
                        // 长按已达 ⇒ 手指纵向一动就进变速（先要求动够一点点，防抖）。
                        if (Math.abs(dy) < 4) return;
                        mode = "zoom";
                    }
                    e.preventDefault();
                    if (mode === "zoom") {
                        applyZoomFromY(dy);
                        return;
                    }
                    // 平移量 = 手指位移的反向（内容跟着手指走），钳制交给 ScrollKernel。
                    kernelHostRef.current?.setScrollLeft(startScrollLeft - dx);
                };
                const onUp = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    activeId = null;
                    if (longPressTimer !== null) {
                        window.clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                    if (mode === "undecided") {
                        // 没超过阈值、也没长按 = 点击 ⇒ 拖时间线。
                        seekAt(e.clientX, true);
                    }
                    if (mode === "armed" || mode === "zoom") setRulerZoomHint(null);
                    mode = "undecided";
                };
                const onCancel = (e: PointerEvent) => {
                    if (e.pointerId !== activeId) return;
                    activeId = null;
                    if (longPressTimer !== null) {
                        window.clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                    if (mode === "armed" || mode === "zoom") setRulerZoomHint(null);
                    mode = "undecided";
                };"""
t = t.replace(old, new, 1)
print("✓ onMove/onUp/onCancel 加 armed/zoom 状态")

# ── ② 在 onDown 里起定时器 + 补局部变量 ─────────────────────────────────────
old2 = '                    // 吃掉这次触摸的兼容鼠标事件，避免与 onMouseDown 路径重复提交。'
assert t.count(old2) == 1, "onDown 尾部锚不唯一"
t = t.replace(old2, """                    // 长按 500ms ⇒ 进入「变速缩放」候选态（规格表：长按出现变速缩放图标）。
                    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
                    longPressTimer = window.setTimeout(armLongPress, LONG_PRESS_MS);
                    // 吃掉这次触摸的兼容鼠标事件，避免与 onMouseDown 路径重复提交。""", 1)
print("✓ onDown 起长按定时器")

# 局部变量声明（放在 bindRulerTouchSeek 开头附近）
old3 = "                let activeId: number | null = null;"
if t.count(old3) == 1:
    t = t.replace(old3, """                let activeId: number | null = null;
                /* E 组：长按变速用的中间量。 */
                let longPressTimer: number | null = null;
                let lastY = 0;
                let startZoomPx = 1;
                let startZoomY = 0;
                let startPxPerSec = 1;""", 1)
    print("✓ 补局部变量")
else:
    # 变量名不同，退化为在 onDown 之前插
    import re
    m = re.search(r"\n(\s+)let mode: [^;]+;", t)
    if m:
        ind = m.group(1)
        t = t[:m.end()] + (f"\n{ind}/* E 组：长按变速用的中间量。 */"
                           f"\n{ind}let longPressTimer: number | null = null;"
                           f"\n{ind}let lastY = 0;"
                           f"\n{ind}let startZoomPx = 1;"
                           f"\n{ind}let startZoomY = 0;"
                           f"\n{ind}let startPxPerSec = 1;") + t[m.end():]
        print("✓ 补局部变量（在 let mode 之后）")
    else:
        print("  ⚠️ 没找到 let mode 声明，需人工确认变量")

TP.write_text(t, encoding="utf-8")
print("✓ TimelinePanel 完成")
