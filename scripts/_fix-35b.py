#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#35：轨道头左划改用原生 touch 事件。"""
from pathlib import Path

TP = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
      / "components" / "layout" / "TimelinePanel.tsx")
t = TP.read_text(encoding="utf-8")

OLD = """                /* E 组：轨道头列**左划 = 隐藏/展开轨道头**（flm 交互表）。
                   ⚠️ 轨道列是原生竖向滚动容器，不能抢它的单指手势 ⇒
                   只在「横向位移 > 48px 且纵向位移 < 24px」这种明确左划时才响应。 */
                let swipeId: number | null = null;
                let swipeStartX = 0;
                let swipeStartY = 0;
                let swipeFired = false;
                const onHeaderSwipeDown = (e: PointerEvent) => {
                    if (e.pointerType === "mouse") return; // 鼠标留给别的交互
                    swipeId = e.pointerId;
                    swipeStartX = e.clientX;
                    swipeStartY = e.clientY;
                    swipeFired = false;
                };
                const onHeaderSwipeMove = (e: PointerEvent) => {
                    if (e.pointerId !== swipeId || swipeFired) return;
                    const dx = e.clientX - swipeStartX;
                    const dy = Math.abs(e.clientY - swipeStartY);
                    // 明确左划：横向够远、纵向够稳（避免把「竖向滚动」误判成左划）。
                    if (dx > -48 || dy > 24) return;
                    swipeFired = true;
                    const on = document.body.getAttribute("data-hs-header-collapsed") === "1";
                    if (on) document.body.removeAttribute("data-hs-header-collapsed");
                    else document.body.setAttribute("data-hs-header-collapsed", "1");
                };
                const onHeaderSwipeUp = (e: PointerEvent) => {
                    if (e.pointerId !== swipeId) return;
                    swipeId = null;
                    swipeFired = false;
                };
                trackListEl.addEventListener("pointerdown", onHeaderSwipeDown);
                trackListEl.addEventListener("pointermove", onHeaderSwipeMove);
                trackListEl.addEventListener("pointerup", onHeaderSwipeUp);
                trackListEl.addEventListener("pointercancel", onHeaderSwipeUp);
                offs.push(() => {
                    trackListEl.removeEventListener("pointerdown", onHeaderSwipeDown);
                    trackListEl.removeEventListener("pointermove", onHeaderSwipeMove);
                    trackListEl.removeEventListener("pointerup", onHeaderSwipeUp);
                    trackListEl.removeEventListener("pointercancel", onHeaderSwipeUp);
                });"""

assert t.count(OLD) == 1, f"锚命中 {t.count(OLD)} 次"

NEW = """                /* E 组：轨道头列**左划 = 收窄轨道头**（flm 交互表）。
                   ⚠️ #35 修正（真机无效、模拟器能过）：
                   轨道列**是原生竖向滚动容器**，真实触摸里浏览器接管滚动后会发
                   `pointercancel`，原来的 `pointermove` 在判定前就被取消了；
                   而 CDP 的**合成事件**不会 cancel ⇒ "模拟器过、真机不过"。
                   ⇒ 改用**原生 touch 事件** + `passive:false`，命中即 preventDefault。 */
                let swipeStartX = NaN;
                let swipeStartY = 0;
                let swipeFired = false;
                const onHeaderTouchStart = (e: TouchEvent) => {
                    if (e.touches.length !== 1) {
                        // 多指交给手势层（缩放/平移），不参与左划判定。
                        swipeStartX = NaN;
                        return;
                    }
                    swipeStartX = e.touches[0].clientX;
                    swipeStartY = e.touches[0].clientY;
                    swipeFired = false;
                };
                const onHeaderTouchMove = (e: TouchEvent) => {
                    if (swipeFired || Number.isNaN(swipeStartX)) return;
                    const tt = e.touches[0];
                    if (!tt) return;
                    const dx = tt.clientX - swipeStartX;
                    const dy = Math.abs(tt.clientY - swipeStartY);
                    // 明确左划：横向够远、纵向够稳（避免把竖向滚动误判成左划）。
                    if (dx > -48 || dy > 24) return;
                    swipeFired = true;
                    e.preventDefault(); // 拦掉这次滚动
                    const on = document.body.getAttribute("data-hs-header-collapsed") === "1";
                    if (on) document.body.removeAttribute("data-hs-header-collapsed");
                    else document.body.setAttribute("data-hs-header-collapsed", "1");
                };
                const onHeaderTouchEnd = () => {
                    swipeStartX = NaN;
                    swipeFired = false;
                };
                trackListEl.addEventListener("touchstart", onHeaderTouchStart, { passive: true });
                trackListEl.addEventListener("touchmove", onHeaderTouchMove, { passive: false });
                trackListEl.addEventListener("touchend", onHeaderTouchEnd, { passive: true });
                trackListEl.addEventListener("touchcancel", onHeaderTouchEnd, { passive: true });
                offs.push(() => {
                    trackListEl.removeEventListener("touchstart", onHeaderTouchStart);
                    trackListEl.removeEventListener("touchmove", onHeaderTouchMove);
                    trackListEl.removeEventListener("touchend", onHeaderTouchEnd);
                    trackListEl.removeEventListener("touchcancel", onHeaderTouchEnd);
                });"""

t = t.replace(OLD, NEW, 1)
TP.write_text(t, encoding="utf-8")
print("✓ #35：改用原生 touch 事件")
