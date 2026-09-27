#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D4：选择工具右下角加三角 → 菜单；新增「拖动」工具（手套图标）。

用户口径（原话）：
> 选择工具右下角也加三角使其变为菜单，新增工具“拖动”（手套图标），
> 相比选择可以在参数区缩放、单指平移而不影响选区与参数，只有单击拍数栏会改变进度条

## 语义拆解

| 动作 | 选择工具 | **拖动工具** |
| :--- | :--- | :--- |
| 参数区单指拖 | 拉选区 / 改参数 | **平移视野**（不动选区与参数）|
| 参数区双指 | 缩放（视当前轴策略）| **缩放**（同）|
| 单击拍数栏 | 移动进度条 | **移动进度条**（保留）|
| 拉选区 | ✅ | ❌ 完全不做 |

⇒ 本质是"**只导航、不编辑**"的手型工具。上游 `toolMode !== "select"` 那批分支
负责"选区相关编辑"，所以拖动工具**不该被它们放行**，但**也不该被当成绘制类工具**。

## 实现要点

把上游那批 `if (toolMode !== "select") return;` 改成
`if (toolMode === "select" || toolMode === "drag") { ... }` 的**反向**表达会牵动太多处，
⇒ 更稳的做法：只在"绘制类"判断处收口 ——
凡是**明确只给绘制工具用**的分支（落笔、vibrato 钩子、cursor=crosshair），
条件从 `toolMode !== "select"` 收紧为 `isDrawTool(toolMode)`；
而"选区相关"分支保持 `toolMode !== "select"` 不变（拖动工具天然不被放行，正合要求）。

⚠️ `toolModeGroup` 另加 `"drag"`（它只管 UI 高亮与菜单归属）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
n = 0

# ── ① 类型 ──────────────────────────────────────────────────────────────────
T = FE / "features" / "session" / "sessionTypes.ts"
t = T.read_text(encoding="utf-8")
t = t.replace('export type ToolModeGroup = "select" | "draw";',
              'export type ToolModeGroup = "select" | "draw" | "drag";', 1)
t = t.replace('export type ToolMode = "select" | DrawToolMode;',
              'export type ToolMode = "select" | "drag" | DrawToolMode;', 1)
T.write_text(t, encoding="utf-8")
n += 2
print("✓ 类型：ToolModeGroup + ToolMode 都加了 drag")

# ── ② setToolMode：drag 单独成组 ────────────────────────────────────────────
S = FE / "features" / "session" / "sessionSlice.ts"
t = S.read_text(encoding="utf-8")
old = """            state.toolMode = action.payload;
            if (action.payload === "select") {
                state.toolModeGroup = "select";
            } else {
                state.toolModeGroup = "draw";
                state.drawToolMode = action.payload;
            }"""
assert t.count(old) == 1, "setToolMode 锚不唯一"
t = t.replace(old, """            state.toolMode = action.payload;
            if (action.payload === "select") {
                state.toolModeGroup = "select";
            } else if (action.payload === "drag") {
                // D4：「拖动」是只导航不编辑的手型工具，与绘制类不同组。
                // 它**不改** drawToolMode —— 切回绘制时仍保留用户上次选的笔/颤音/还原。
                state.toolModeGroup = "drag";
            } else {
                state.toolModeGroup = "draw";
                state.drawToolMode = action.payload;
            }""", 1)
S.write_text(t, encoding="utf-8")
n += 1
print("✓ setToolMode：drag 单独成组，且不覆盖 drawToolMode")

# ── ③ 绘制类判断收口 ────────────────────────────────────────────────────────
H = FE / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = H.read_text(encoding="utf-8")

# 落笔 / 笔迹相关：把 toolMode !== "select" 改成"是绘制类"
subs = [
    ('        if (toolMode !== "select") {\n', '        if (isDrawToolMode(toolMode)) {\n'),
]
for a, b in subs:
    if t.count(a) == 1:
        t = t.replace(a, b, 1)
        n += 1
        print(f"  ✓ 落笔分支收口为 isDrawToolMode")

# cursor：crosshair 只给绘制类
old_cur = '        return toolMode === "select" ? "default" : "crosshair";'
if t.count(old_cur) == 1:
    t = t.replace(old_cur,
        '        // D4：拖动工具用抓取光标（手型），选择工具默认箭头，绘制类十字。\n'
        '        if (toolMode === "drag") return "grab";\n'
        '        return toolMode === "select" ? "default" : "crosshair";', 1)
    n += 1
    print("  ✓ cursor：drag ⇒ grab")

# 插入 helper（放在文件里第一个 export 之前）
import re
if "function isDrawToolMode" not in t:
    m = re.search(r"^export ", t, re.M)
    assert m, "找不到第一个 export"
    helper = """/**
 * D4：「绘制类」工具判定。
 *
 * `ToolMode` 现在有四档：`select` / `drag` / `line`·`vibrato` / `draw`·`restore`。
 * 只有**绘制类**才落笔改数据；`select` 拉选区（不落笔），`drag` 纯导航（既不落笔也不选区）。
 *
 * ⚠️ 上游原来用 `toolMode !== "select"` 表达"绘制类"，加入 `drag` 后会误放行，
 * 所以在这里收口成一个函数，避免散落各处再次漏改。
 */
function isDrawToolMode(mode: string): boolean {
    return mode !== "select" && mode !== "drag";
}

"""
    t = t[:m.start()] + helper + t[m.start():]
    n += 1
    print("  ✓ 加了 isDrawToolMode helper")

H.write_text(t, encoding="utf-8")
print(f"\n共 {n} 处")
