#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""更新 TASKS.md 的 #7 状态（代码完成、构建装机通过、画线手势待实测）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

old = next((l for l in t.splitlines() if l.startswith("| 7 |")), None)
assert old, "没找到 #7 行"

new = (
    "| 7 | 直线/颤音画完显示横纵两个滑动条（横=波长，纵=振幅），点空白确认关闭 | "
    "✅ **代码完成、构建装机通过**（tsc 干净、`logs/android.log` 无新增错误）。"
    "🔑 两个发现把工作量砍半：① `vibratoStateRef` 的**五个清空出口只有一个是「提交」**"
    "（`commitStroke` 之后），其余四处是 `onCancel`（明确不写后端）⇒ **钩子只挂一处**；"
    "② **不用新建后端通道** —— `buildVibratoDense`+`commitStroke` 都在同一 hook 里，"
    "滑条改动重算密集点覆盖即可。"
    "落点：新文件 `pianoRoll/VibratoAdjustOverlay.tsx`（锚在**画完时指针位置**上方，不做坐标换算）"
    "+ hook 加 `onVibratoCommitted`/`onVibratoAdjustReady` + `lastVibratoRef`（只改波形、不改走向）"
    "+ `PianoRollPanel` 接 prop、`createPortal` 渲染、点空白关闭（排除拍数栏/钢琴栏/工具栏/菜单栏）。"
    "⏳ **待你实测**：进「参数」页 → 切「直线/颤音」工具 → 画一条线 → 看是否弹滑条。"
    "⚠️ 我驱动不了工具切换（找不到「切到颤音」的入口，快捷键 `kb_mode_vibrato_tool` 在模拟器上也没有键盘）| A | WIP:待实测 |"
)
t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ TASKS.md：#7 已更新为「代码完成 / 待实测」")
