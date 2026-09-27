#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B1：气声音量的**左侧图标**与其右侧开启状态的图标一致（只除颜色）。

用户口径：
> 气声音量的左侧图标可以与其右侧开启的图标一致（除了颜色）

现状（读代码）：
· 右侧 = `BreathAirIcon`（在 `breath_gain` 药丸的 `trailing` 里，是开关按钮）
· 左侧 = 纯文字 label（`getProcessorParamShortLabel(p)` ⇒ "气声"）

⇒ 给 `ParamToolbarPill` 加一个可选的 `leadingIcon`，在 label 前渲染；
   `breath_gain` 传 `<BreathAirIcon />`（不带 off 斜杠 —— 状态由右侧开关表达）。
   颜色区分：左侧图标跟随 label 的当前文字色（主题/前景），右侧开关仍用强调色。

⚠️ `BreathAirIcon` 已经 `export`（见它的注释：「手机端 👁 菜单的气声开关也用这一个图形」），
   这里的用法与那条注释一致 —— 同一个图形只画一份。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "PianoRollPanel.tsx")
t = P.read_text(encoding="utf-8")
n = 0

# ── ① Props：加 leadingIcon ─────────────────────────────────────────────────
a1 = """    /** 可选尾部片段（如气声开关）：渲染在参数名之后、子参数下拉之前 */
    trailing?: React.ReactNode;"""
assert t.count(a1) == 1, "Props 锚不唯一"
t = t.replace(a1, """    /**
     * 可选**前置图标**：渲染在参数名之前。
     * 目前用于「气声音量」—— 用户口径「左侧图标与其右侧开启状态的图标一致（只除颜色）」。
     */
    leadingIcon?: React.ReactNode;
    /** 可选尾部片段（如气声开关）：渲染在参数名之后、子参数下拉之前 */
    trailing?: React.ReactNode;""", 1)
n += 1

# ── ② 组件：解构 + 渲染 ─────────────────────────────────────────────────────
a2 = """    eyeLabel,
    trailing,
    dropdown,
}) => {"""
assert t.count(a2) == 1, "解构锚不唯一"
t = t.replace(a2, """    eyeLabel,
    leadingIcon,
    trailing,
    dropdown,
}) => {""", 1)
n += 1

a3 = """                onClick={onSelect}
            >
                {label}
            </button>"""
assert t.count(a3) == 1, "label 锚不唯一"
t = t.replace(a3, """                onClick={onSelect}
            >
                {leadingIcon ? (
                    <span className="param-pill__leading-icon" aria-hidden="true">
                        {leadingIcon}
                    </span>
                ) : null}
                {label}
            </button>""", 1)
n += 1

# ── ③ 气声药丸传图标 ───────────────────────────────────────────────────────
a4 = """                                <ParamToolbarPill
                                    key={p.id}
                                    label={getProcessorParamShortLabel(p)}
                                    labelTooltip={getProcessorParamLabel(p)}"""
assert t.count(a4) == 1, "药丸锚不唯一"
t = t.replace(a4, """                                <ParamToolbarPill
                                    key={p.id}
                                    label={getProcessorParamShortLabel(p)}
                                    labelTooltip={getProcessorParamLabel(p)}
                                    /* B1：气声音量的左侧图标 = 右侧开关同款图形（只除颜色） */
                                    leadingIcon={p.id === "breath_gain" ? <BreathAirIcon /> : undefined}""", 1)
n += 1

P.write_text(t, encoding="utf-8")
print(f"✓ B1：改了 {n} 处（leadingIcon prop + 渲染 + 气声传图标）")

# ── ④ 样式：图标与文字间距 ──────────────────────────────────────────────────
CSS = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src" / "index.css")
c = CSS.read_text(encoding="utf-8")
if "param-pill__leading-icon" not in c:
    c = c.rstrip("\n") + """

/* B1：参数药丸的前置图标（气声音量等）——与 label 同一行、垂直居中。 */
.param-pill__leading-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 3px;
    /* 跟随 label 的文字色（状态由右侧开关的强调色表达） */
    color: currentColor;
    flex-shrink: 0;
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ 加了 .param-pill__leading-icon 样式")
else:
    print("  · 样式已存在")
