#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#42 "轨道"菜单**明明放得下却靠右** —— 修 `menuAlign` 的判据。

## 根因

```ts
// #15②：放不下就靠右上角。用内容自然宽度粗估（最宽的「视图」菜单约 460px），
// 宁可估大：宁可提前切右对齐，也不要"先贴左、再被推"的跳动。
setMenuAlign(left + 460 > window.innerWidth ? "end" : "start");
```

`460` 是**桌面**（最宽菜单）的估计值，注释也写明"**宁可估大**"。
但**手机屏宽只有 360** ⇒ `left + 460 > 360` **恒成立**（`left ≥ 0`）
⇒ **手机上市面上每个菜单都靠右**，与"放不放得下"完全无关。

## 修法

把固定值换成**按屏宽自适应**的估计：

```ts
const estimate = Math.min(460, Math.round(window.innerWidth * 0.75));
setMenuAlign(left + estimate > window.innerWidth ? "end" : "start");
```

- 桌面（≥1280）⇒ `Math.min(460, 960)` = 460 ⇒ **行为不变**；
- 手机（360）⇒ `Math.min(460, 270)` = 270 ⇒ 只有 `left > 90` 才切右对齐 ——
  即**母菜单靠到屏幕右侧 3/4 之后**才切，这才是"放不下"的真实含义。

⚠️ 另外 CSS 本来就有兜底（`index.css` 里 `.rt-DropdownMenuContent { max-width:
calc(100vw - var(--hs-menu-anchor) - 8px) }`）⇒ 即使估小了，菜单也**不会溢出屏幕**，
只会变得更窄。所以这次调整**不会引入溢出风险**。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MB = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "MenuBar.tsx"
t = MB.read_text(encoding="utf-8")

old = """            // #15②：放不下就靠**右上角**。用内容自然宽度粗估（最宽的「视图」菜单约 460px），
            // 宁可估大：宁可提前切右对齐，也不要"先贴左、再被推"的跳动。
            setMenuAlign(left + 460 > window.innerWidth ? "end" : "start");"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """            /* #15②：放不下就靠**右上角**。
             *
             * 🔴 #42 修正：原来写死 `460`（桌面最宽菜单的粗估，注释也写了"宁可估大"），
             * 但**手机屏宽只有 360** ⇒ `left + 460 > 360` **恒成立** ⇒
             * 手机上市面上每个菜单都靠右，跟"放不放得下"无关（用户报的「位置够却靠右」）。
             *
             * ⇒ 改成**按屏宽自适应**：桌面仍是 460（行为不变）；
             *   手机上取屏宽的 3/4 ⇒ 只有母菜单靠到屏幕右侧 3/4 之后才切右对齐。
             *
             * ⚠️ 有 CSS 兜底（`.rt-DropdownMenuContent { max-width:
             *   calc(100vw - var(--hs-menu-anchor) - 8px) }`）⇒ 估小也不会溢出。
             */
            const naturalWidth = Math.min(460, Math.round(window.innerWidth * 0.75));
            setMenuAlign(left + naturalWidth > window.innerWidth ? "end" : "start");"""

t = t.replace(old, new, 1)
MB.write_text(t, encoding="utf-8")
print("✓ #42：menuAlign 判据按屏宽自适应（桌面 460 / 手机屏宽×0.75）")
