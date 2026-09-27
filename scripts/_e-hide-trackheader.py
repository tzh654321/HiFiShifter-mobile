#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（轨道头列）：**左划 = 隐藏轨道头**。

规格（flm 交互表，轨道头这一列）：

| 手势 | 行为 |
| :--- | :--- |
| 单击 | 切换轨道 ✅ 已有 |
| 划动 | 上下划平移 ✅ 已有；**左划隐藏轨道头** ← 本步 |
| 长按 | 打开轨道菜单 ✅ 已有（contextmenu 等价物）|
| 长按并划动 | 移动轨道顺序 ✅ 已有（拖拽换序）|

⇒ **只缺"左划折叠/展开轨道头"**。

## 做法（不碰布局代码）

轨道头列的根元素已有 `data-track-list-panel` 属性 ⇒
用 **`body` 打标 + CSS 折叠**，不动任何布局计算：

```css
body[data-hs-header-collapsed="1"] [data-track-list-panel] { display: none; }
```

状态放在 DOM 属性上而不是 redux —— 这是纯展示开关、无需跨组件读取
（若以后要在菜单里暴露，再提升到 redux）。

## 左划怎么判

轨道列**本身是原生竖向滚动容器**（`attachSurface(el, "y")`），
不能抢它的单指手势。所以这里只加一层**极轻的横向判定**：
`pointerdown → pointermove`，**横向位移超过 48px 且纵向位移 < 24px**（明确左划）
才触发折叠；触发后立即标记，不再重复触发，直到抬手。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 左划监听：挂在 attachAxisSurfaces 的 offs 里 ─────────────────────────
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                rulerEl.addEventListener("dblclick", onRulerDblClick);
                offs.push(() => rulerEl.removeEventListener("dblclick", onRulerDblClick));
                return true;"""
assert t.count(old) == 1, "attachAxisSurfaces 尾部锚不唯一"
t = t.replace(old, """                rulerEl.addEventListener("dblclick", onRulerDblClick);
                offs.push(() => rulerEl.removeEventListener("dblclick", onRulerDblClick));

                /* E 组：轨道头列**左划 = 隐藏/展开轨道头**（flm 交互表）。
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
                });
                return true;""", 1)
TP.write_text(t, encoding="utf-8")
print("✓ TimelinePanel：轨道列加左划折叠/展开")

# ── ② CSS ───────────────────────────────────────────────────────────────────
CSS = FE / "index.css"
c = CSS.read_text(encoding="utf-8")
if "hs-header-collapsed" not in c:
    c = c.rstrip("\n") + """

/*
 * E 组（flm 交互表，轨道头列）：**左划隐藏轨道头**（再左划一次展开）。
 *
 * 状态放在 `body` 属性上而不是 redux —— 纯展示开关，没有别处要读它；
 * 以后若要暴露到菜单，再提升到 redux。
 * 折叠直接 `display: none` 整列（`data-track-list-panel` 是 TrackList 的滚动容器，
 * 它同时就是「轨道头那一列」），不动任何布局计算。
 */
body[data-hs-header-collapsed="1"] [data-track-list-panel] {
    display: none;
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ index.css：折叠规则")
else:
    print("  · CSS 已存在")
