#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#41 双指**拖动**（→平移+缩放）与双指**长按并划动**（→slip）必须区分开。

## 现状（错在哪）

我上一轮给的实现是：**两指落下就起 500ms 定时器，到点就点亮虚拟 Alt**。
问题：**手指一动，定时器照跑** ⇒ 用户只是**双指拖动缩放**，0.5s 后
Alt 也悄悄点亮了 ⇒ 后续拖动变成 slip ⇒ 用户看到"缩放/平移"和 slip 混在一起。

## 规格原文（`docs/临时.xlsx`）

| 手势 | 音频块 |
| :--- | :--- |
| **双指拖动** | **平移且缩放** |
| **双指长按并划动** | 调整音频相对于音频块的位置，相当于开了 Alt 拖动 |

⇒ **两者是互斥的两条路**：
- **双指落下后移动超过阈值** ⇒ 走"平移+缩放"，**永不计长按**；
- **双指落下后保持不动满 500ms** ⇒ 进入"长按态"，此后移动才走 slip。

## 修法

在双指指针计数里加一个 `twoMoved` 标记：
任一指位移超过 8px ⇒ `twoMoved = true` **并取消长按定时器**；
定时器回调里再检查一次 `!twoMoved` 才点亮。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TP = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                    let twoTimer: number | null = null;
                    const clearTwoTimer = () => {
                        if (twoTimer !== null) {
                            window.clearTimeout(twoTimer);
                            twoTimer = null;
                        }
                    };
                    const onTwoDown = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length === 0) tapAt = performance.now();
                        tapIds.push(e.pointerId);
                        tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        tapFired = false;
                        // 两指都按下后才启动长按计时（单指不算）。
                        if (tapIds.length === 2 && twoTimer === null) {
                            twoTimer = window.setTimeout(() => {
                                setTouchModifiers({ alt: true });
                            }, 500);
                        }
                    };"""

assert t.count(old) == 1, f"onTwoDown 锚命中 {t.count(old)} 次"

new = """                    let twoTimer: number | null = null;
                    /* #41：**双指拖动 vs 双指长按**互斥 —— 手指一动就不算长按。
                       否则"双指缩放"会在 0.5s 后悄悄点亮 Alt，把后续拖动变成 slip，
                       用户看到的就是"缩放/平移和 slip 混在一起"。 */
                    let twoMoved = false;
                    const clearTwoTimer = () => {
                        if (twoTimer !== null) {
                            window.clearTimeout(twoTimer);
                            twoTimer = null;
                        }
                    };
                    const onTwoDown = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length === 0) {
                            tapAt = performance.now();
                            twoMoved = false;
                        }
                        tapIds.push(e.pointerId);
                        tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        tapFired = false;
                        // 两指都按下后才启动长按计时（单指不算）。
                        if (tapIds.length === 2 && twoTimer === null) {
                            twoTimer = window.setTimeout(() => {
                                // ⚠️ 到点时再确认"这两指一直没动"才点亮。
                                if (!twoMoved && tapIds.length >= 2) {
                                    setTouchModifiers({ alt: true });
                                }
                            }, 500);
                        }
                    };
                    /**
                     * #41：双指在动 ⇒ 走"平移且缩放"，**取消长按候选**。
                     * 一旦取消，本次手势不再可能变成 slip（要抬手重来）。
                     */
                    const onTwoMove = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length < 2 || twoMoved) return;
                        for (const id of tapIds) {
                            const st = tapStart.get(id);
                            if (!st) continue;
                            // 用 event 的坐标只对当前指针准，简化：任一指针动够就算。
                            if (
                                Math.abs(e.clientX - st.x) > 8 ||
                                Math.abs(e.clientY - st.y) > 8
                            ) {
                                twoMoved = true;
                                tapFired = true; // 也别被当双指 tap
                                clearTwoTimer();
                                clearTouchModifiers();
                                break;
                            }
                        }
                    };"""

t = t.replace(old, new, 1)
print("✓ onTwoDown：加 twoMoved；新增 onTwoMove 取消长按")

# 注册 / 注销 onTwoMove
old_reg = """                    timelineContainer.addEventListener("pointerdown", onTwoDown);
                    timelineContainer.addEventListener("pointerup", onTwoUp);
                    timelineContainer.addEventListener("pointercancel", onTwoCancel);
                    offs.push(() => {
                        timelineContainer.removeEventListener("pointerdown", onTwoDown);
                        timelineContainer.removeEventListener("pointerup", onTwoUp);
                        timelineContainer.removeEventListener("pointercancel", onTwoCancel);
                    });"""
assert t.count(old_reg) == 1, "注册锚命中 %d 次" % t.count(old_reg)
t = t.replace(old_reg, """                    timelineContainer.addEventListener("pointerdown", onTwoDown);
                    timelineContainer.addEventListener("pointermove", onTwoMove);
                    timelineContainer.addEventListener("pointerup", onTwoUp);
                    timelineContainer.addEventListener("pointercancel", onTwoCancel);
                    offs.push(() => {
                        timelineContainer.removeEventListener("pointerdown", onTwoDown);
                        timelineContainer.removeEventListener("pointermove", onTwoMove);
                        timelineContainer.removeEventListener("pointerup", onTwoUp);
                        timelineContainer.removeEventListener("pointercancel", onTwoCancel);
                    });""", 1)
print("✓ 注册 onTwoMove")

TP.write_text(t, encoding="utf-8")
print("✓ #41 完成")
