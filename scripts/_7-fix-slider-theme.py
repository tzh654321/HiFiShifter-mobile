#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 浮层的 UI 修正（用户反馈）。

用户口径：
  1. 「滑条的颜色要为主题色」
  2. 「并检查其它你修改的没遵循主题色的地方」
  3. 「滑条右边的数字出界了」

**问题 1+3 的根因**：我用了 HTML 原生 `<input type=range>` 的 `accentColor: var(--accent-9)`
—— 这只能染原生的部分样式，**跟不上项目主题**。而 `index.css` 里上游**早就定义了
`.qt-range`**（L428-465）：track 用 `--qt-border`、thumb 用 `--accent-9`，
参数编辑器「平滑度」等滑杆都用它。
⇒ 改用 `className="qt-range"` 并去掉 `accentColor`，与全局一致。

**问题 2 的根因**：面板宽 196px，滑条固定 128px + 标签 26px + 数值 34px + 间隙
⇒ 数值被挤出去/出界。⇒ 面板加宽到 232px，数值列加宽到 40px。

顺带自查我改过的其它 UI：
  · `FileBrowserPanel` 的「授权访问目录」按钮 —— 用的是 Radix `<Button variant="soft">`，
    走主题 ✓
  · `MenuBar` / `MobileTopBar` 的菜单定位改动 —— 纯几何，无颜色 ✓
  · `ExportAudioDialog` 的 `minWidth` 调整 —— 纯几何 ✓
  · `PianoRollPanel` 的 portal 渲染 —— 无样式 ✓
⇒ **只有这个新浮层有主题色问题**。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "VibratoAdjustOverlay.tsx")
t = P.read_text(encoding="utf-8")

n = 0

# ── ① 面板加宽（数值出界）────────────────────────────────────────────────────
if "const PANEL_W = 196;" in t:
    t = t.replace("const PANEL_W = 196;",
                  "// 232：原先 196 装不下「标签26 + 滑条128 + 数值34 + 间隙」⇒ 数值出界。\nconst PANEL_W = 232;", 1)
    n += 1

# ── ② 滑条改用项目的 .qt-range（主题色）──────────────────────────────────────
old_input = """                aria-label={label}
                // 拖动中（input）走节流预览；松手（change）立即落盘
                onChange={(e) => onChangeValue(Number(e.target.value), false)}
                onPointerUp={(e) => {
                    stop(e);
                    onChangeValue(Number((e.target as HTMLInputElement).value), true);
                }}
                onPointerDown={stop}
                style={{
                    flex: "1 1 auto",
                    width: vertical ? 128 : 128,
                    height: 22,
                    accentColor: "var(--accent-9, #5b5bd6)",
                    touchAction: "none",
                }}"""
new_input = """                aria-label={label}
                // 拖动中（input）走节流预览；松手（change）立即落盘
                onChange={(e) => onChangeValue(Number(e.target.value), false)}
                onPointerUp={(e) => {
                    stop(e);
                    onChangeValue(Number((e.target as HTMLInputElement).value), true);
                }}
                onPointerDown={stop}
                /* 用项目的 .qt-range：track=--qt-border、thumb=--accent-9（主题色）。
                   不要用原生 accentColor —— 那个跟不上主题。 */
                className="qt-range"
                style={{
                    flex: "1 1 auto",
                    width: 128,
                    touchAction: "none",
                }}"""
assert t.count(old_input) == 1, "滑条锚不唯一"
t = t.replace(old_input, new_input, 1)
n += 1

# ── ③ 数值列加宽 ────────────────────────────────────────────────────────────
old_num = """            <span style={{ fontSize: 10, width: 34, textAlign: "right", opacity: 0.6, flexShrink: 0 }}>
                {vertical ? value.toFixed(2) : Math.round(value)}
            </span>"""
new_num = """            <span
                style={{
                    fontSize: 10,
                    width: 40,
                    textAlign: "right",
                    opacity: 0.65,
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {vertical ? value.toFixed(2) : Math.round(value)}
            </span>"""
if t.count(old_num) == 1:
    t = t.replace(old_num, new_num, 1)
    n += 1

# ── ④ 「完成」键改用主题强调色（原来是透明底 + 边框）─────────────────────────
old_btn = """                    style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--qt-border, rgba(255,255,255,0.18))",
                        background: "transparent",
                        color: "var(--qt-text)",
                        cursor: "pointer",
                        touchAction: "none",
                    }}"""
new_btn = """                    style={{
                        fontSize: 11,
                        padding: "3px 11px",
                        borderRadius: 6,
                        border: "1px solid transparent",
                        // 主题强调色（与 .qt-range 的 thumb 同一套变量）
                        background: "var(--accent-9)",
                        color: "var(--accent-contrast, #fff)",
                        cursor: "pointer",
                        touchAction: "none",
                    }}"""
if t.count(old_btn) == 1:
    t = t.replace(old_btn, new_btn, 1)
    n += 1

P.write_text(t, encoding="utf-8")
print(f"✓ VibratoAdjustOverlay：改了 {n} 处（面板加宽 / .qt-range / 数值列 / 完成键主题色）")
