#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D2：笔菜单加入「还原」工具（等价于电脑上右键拖动参数）。

用户口径：
> 笔菜单加入“还原”工具（需图标），相当于电脑右键拖动参数

上游原本只有一条「还原」入口：**右键 / 笔杆键（button 2）或笔橡皮端（button 5）**，
即 `const mode: StrokeMode = secondaryDown ? "restore" : "draw";`
（`usePianoRollInteractions.ts`，注释写得很清楚）。
手机上既没有右键也没有笔杆键 ⇒ 这个能力完全不可达。

⇒ 做法：
1. `DrawToolMode` 加一个 `"restore"` 值；
2. 工具模式为 `restore` 时，落笔即按 `"restore"` 走（与右键同一条路径，**不新开代码路径**）；
3. 在笔菜单（绘制按钮的三角 / 长按）里加入该项，并配一个图标。

⚠️ `ToolMode = "select" | DrawToolMode` 会自动带上新值，无需改。
⚠️ `currentDrawTool` 那两个映射（`"line"|"vibrato"` → `vibrato`）不受影响 —— `restore` 独立成档。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 类型 ──────────────────────────────────────────────────────────────────
T = FE / "features" / "session" / "sessionTypes.ts"
t = T.read_text(encoding="utf-8")
a = 'export type DrawToolMode = "draw" | "line" | "vibrato";'
assert t.count(a) == 1, "类型锚不唯一"
t = t.replace(a, 'export type DrawToolMode = "draw" | "line" | "vibrato" | "restore";', 1)
T.write_text(t, encoding="utf-8")
print("✓ DrawToolMode 加了 restore")

# ── ② 落笔模式：restore 工具 ⇒ restore 模式 ──────────────────────────────────
H = FE / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = H.read_text(encoding="utf-8")
a2 = '            const mode: StrokeMode = secondaryDown ? "restore" : "draw";'
assert t.count(a2) == 1, "mode 锚不唯一"
t = t.replace(a2, """            // D2：「还原」工具（手机上没有右键/笔杆键 ⇒ 用它替代电脑上的右键拖动）。
            // 与 secondaryDown 走**同一条服务端路径**，不新开分支。
            const mode: StrokeMode =
                toolMode === "restore" || secondaryDown ? "restore" : "draw";""", 1)
print("✓ 落笔模式：restore 工具 ⇒ restore")
H.write_text(t, encoding="utf-8")

# ── ③ 工具面板：加「还原」项 ────────────────────────────────────────────────
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")
import re
# 找绘制工具子菜单里的两项（绘制 / 颤音）
m = re.search(r"(\s*)\{(?:/\*[^}]*?\*/\s*)?.{0,200}?[\"']vibrato[\"'].{0,300}?\}", t)
print(f"  子菜单定位: {'找到' if m else '未找到'}")
if m:
    print("  片段:", m.group(0)[:220].replace("\n", " "))
