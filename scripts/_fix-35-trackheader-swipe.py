#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#35 轨道头左划在**真机**无效（模拟器 CDP 合成事件能过）。

## 根因

轨道列**本身是原生竖向滚动容器**（`attachSurface(trackListEl, "y")` +
`suppressTwoFingerScroll`）。在真实触摸里，"竖向滚动"由浏览器接管后
会发出 **`pointercancel`** —— 我原来挂的 `pointermove` 于是在判定前就被取消了。

⚠️ 模拟器 CDP 派发的是**合成事件**，浏览器不会接管滚动 ⇒ 永远不会 cancel
⇒ **模拟器能过、真机不过**。这是"CDP 合成事件"的典型盲区。

## 修法

改用**原生 touch 事件** + `passive: false`：

- `touchstart` 记起点（两指以上直接放弃）；
- `touchmove` 里判"横向 ≤ -48px 且纵向 < 24px"⇒ 切换折叠；
  **命中后 `preventDefault()`** 阻止这次滚动；
- `touchend/cancel` 清理。

⚠️ `preventDefault` 必须在 `touchmove` 里**第一次**调用才有效，
所以判定要尽早（阈值别太大）；这里 48px 是权衡后的值 ——
比它小的横向位移本来也会被当成滚动。

⚠️ 只在**单指**时判：双指是缩放/平移，交给手势层。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TP = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

# 找到原来那段 pointer 版实现（我之前加的）
start = t.find("                /* E 组（轨道列）：**左划 = 隐藏/展开轨道头**（flm 交互表）。")
assert start != -1, "找不到左划实现的开头"

# 结束标记：紧跟其后的 offs.push 块结束（`});` 行）
end_marker = """                offs.push(() => {
                    trackListEl.removeEventListener("pointerdown", onHeaderSwipeDown);
                    trackListEl.removeEventListener("pointermove", onHeaderSwipeMove);
                    trackListEl.removeEventListener("pointerup", onHeaderSwipeUp);
                    trackListEl.removeEventListener("pointercancel", onHeaderSwipeUp);
                });"""
end = t.find(end_marker, start)
assert end != -1, "找不到左划实现的结尾"
end += len(end_marker)

NEW = """                /* E 组（轨道列）：**左划 = 收窄轨道头**（flm 交互表）。
                   ⚠️ #35 修正（真机无效）：轨道列**是原生竖向滚动容器**，
                   真实触摸里浏览器接管滚动后会发 `pointercancel`，
                   原来挂的 `pointermove` 在判定前就被取消了 ——
                   而模拟器 CDP 的**合成事件**不会 cancel，所以"模拟器过、真机不过"。
                   ⇒ 改用**原生 touch 事件** + `passive:false`，命中即 preventDefault。 */
                let swipeStartX = 0;
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

t = t[:start] + NEW + t[end:]
TP.write_text(t, encoding="utf-8")
print("✓ #35：轨道头左划改用原生 touch 事件（真机可用）")
print("   ⚠️ 顺带记：这条证明了「CDP 合成事件」测不出 pointercancel 类问题")
