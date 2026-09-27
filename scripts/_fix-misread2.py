#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正「拍数栏长按变速」这条虚构待办的具体 4 处。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

CORRECTION = "❌ **不是需求**（读图串列，见文末更正）"

# ── ① TASKS.md ───────────────────────────────────────────────────────────
T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
n = 0

# L192：四区域核对结论
old = "拍数栏（差「长按变速」，**需先扩内核接口**）。**上游完整度远超清单观感：20+ 条里真正缺的只有 6 条** |"
new = "拍数栏 ✅全齐（**曾经的「差长按变速」是我读图串列**，见文末更正）。**上游完整度远超清单观感** |"
if old in t:
    t = t.replace(old, new, 1); n += 1; print("✓ ① 四区域核对结论")

# L214：暂缓说明
old = "⚠️ **拍数栏「长按出变速图标 + 下划调整变速」暂缓**：`TimelineKernelHost` 没暴露"
new = "❌ **更正**：这里原本写的「拍数栏长按出变速图标」**是我读图串列** —— 规格表里那一格是「**控制点**」列，\n且控制点相关两条**早已完成**（见上表）。**拍数栏的长按在规格表里就是 `-`**。以下这段历史备注保留作记录：\n\n⚠️ ~~拍数栏「长按出变速图标 + 下划调整变速」暂缓~~：`TimelineKernelHost` 没暴露"
if old in t:
    t = t.replace(old, new, 1); n += 1; print("✓ ② 暂缓说明")

# L469：真未做清单
old = "- **⏳ 真未做**：**#11 双开互相复制** · 拍数栏长按变速（**需先扩内核接口**）· #9 音频路径 · 补丁 regen"
new = "- **⏳ 真未做**：**#11 双开互相复制** · #9 音频路径 · 补丁 regen\n  （~~拍数栏长按变速~~ **已证伪**，见文末更正）"
if old in t:
    t = t.replace(old, new, 1); n += 1; print("✓ ③ 真未做清单")

T.write_text(t, encoding="utf-8")
print(f"  TASKS.md 共改 {n} 处")

# ── ② docs/16 审计文档 ───────────────────────────────────────────────────
A = ROOT / "docs" / "16-任务审计-20260927.md"
a = A.read_text(encoding="utf-8")
n2 = 0

old = "| **拍数栏「长按出变速图标 + 下划调整」** | 24 格里唯一剩下的 | ⚠️ `TimelineKernelHost` 没暴露 `getPxPerSec`/`setHorizontal`，横向缩放真值在 `ScrollKernel` 里 ⇒ **要先扩接口**，属设计改动 |"
if old in a:
    a = a.replace(old, "", 1); n2 += 1; print("✓ ④ docs/16 删掉那条")

old = "| **#11 改造** | **双开 HiFiShifter 互相复制** | 你刚拍板的方向（reaper/vsh 无手机版，不做跨应用）|"
new = ("| **#11 改造** | **双开 HiFiShifter 互相复制** | 你刚拍板的方向（reaper/vsh 无手机版，不做跨应用）|\n"
       "| ~~拍数栏长按变速~~ | ❌ **不是需求** | **我读图串列**：规格表里那是「**控制点**」列（且早已完成）。"
       "**拍数栏的长按在规格表里就是 `-`** ⇒ **E 组实际 24/24 全完成** |")
if old in a:
    a = a.replace(old, new, 1); n2 += 1; print("✓ ⑤ docs/16 标注不是需求")

A.write_text(a, encoding="utf-8")
print(f"  docs/16 共改 {n2} 处")
