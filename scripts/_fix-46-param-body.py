#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#46 参数钢琴条缩放触碰边缘卡住 —— 给**主体**也挂双指表面。

## 根因

`PianoRollPanel` 里双指只挂在两块区域：

```ts
offs.push(controller.attachSurface(axisEl, "y"), controller.attachSurface(rulerEl, "x"));
//   axisEl = 左侧音高轴（43px 宽）   rulerEl = 顶部拍数栏（47px 高）
```

**钢琴条主体（滚动容器）没有挂** ⇒ 手指落在主体上时：
- 单指：走原生滚动（正常）；
- **双指：不进入手势会话** ⇒ 想缩放必须把手指挪到那两条窄边上；
- 手指一旦滑出窄边 ⇒ **会话中断 ⇒ "卡住"**。

⇒ 用户描述的"触碰边缘依旧卡住"正是这个：**只有边缘能缩放，一离开就断**。

## 规格

用户明确：**"不要求触点贴合图形"** —— 即手指落在哪儿都应该能缩放，
不该有"必须点在轴/拍数栏上"这种几何限制。

## 做法

给**滚动容器本体**也挂一次 `attachSurface(scrollerEl, "both")`：

- 轴向用 `"both"`（主体四周无边界，横竖都该响应）；
- ⚠️ **安全**：`attachSurface` 只绑事件、**不改 `touch-action`**
  （改 `touch-action` 的只有 `attach()`，且只对 `target` 那个主容器）
  ⇒ 不会把原生的**单指纵向滚动**禁掉。

⇒ 两指落在主体任意位置都进同一状态机（本来就共用 `controller`），
锚点仍以真正持 scrollLeft 的容器为坐标系，与挂哪个表面无关。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PP = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

old = """            offs.push(controller.attachSurface(axisEl, "y"), controller.attachSurface(rulerEl, "x"));"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """            /* #46：**钢琴条主体也必须挂** ——
               原来只挂了左侧音高轴（"y"）和顶部拍数栏（"x"），
               手指落在主体上时**双指不进入会话** ⇒ 想缩放只能把手指凑到那两条窄边上，
               一滑出去就"卡住"。用户明确「**不要求触点贴合图形**」⇒ 主体整片都要能缩放。

               ⚠️ 轴向 `"both"`：主体四周无边界，横竖都该响应。
               ⚠️ **安全**：`attachSurface` 只绑事件、**不改 `touch-action`**
                  （改它的只有 `attach()`，且只对主容器）⇒ 原生单指纵向滚动不受影响。 */
            const bodyEl = scrollerRef.current;
            offs.push(
                controller.attachSurface(axisEl, "y"),
                controller.attachSurface(rulerEl, "x"),
                ...(bodyEl ? [controller.attachSurface(bodyEl, "both")] : []),
            );"""

t = t.replace(old, new, 1)
PP.write_text(t, encoding="utf-8")
print("✓ #46：钢琴条主体也挂 attachSurface(..., 'both')")
