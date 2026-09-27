#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按用户澄清更新 TASKS.md（#5 根因已定位并修、#13 确认无需改动、#15 精度修正、#16 关闭）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

repl = [
    # #5：根因 + 已修
    ("| 5 | 共振峰窗口超出屏幕 | 表单窗口宽度需要按视口钳制（参照已有 `<1280px` 的 `[role=\"dialog\"]` 兜底规则）| ? | TODO |",
     "| 5 | 共振峰窗口超出屏幕 | ✅ **根因找到并已修**。用户澄清：指**音频块上的「F」按钮**打开的浮窗。"
     "根因 = `VowelChart` 是**死宽 420×320** 的 SVG，而手机上浮窗被 `maxWidth: calc(100vw−16px)` 压到 344px，"
     "扣掉 `px-3`+`p-2`（40px）后内容区只剩 ~304px ⇒ **图形右侧 116px 跑到屏幕外**。"
     "已加 `maxWidth:100%` + `height:auto`（靠 viewBox 等比缩放）。⚠️ 实测 `ClipFormantToolWindow.tsx` **没被任何对话改过**，"
     "所以是原版问题 | A | DONE:09-24 |"),

    # #13：确认与描述一致
    (None, "13"),  # 占位，下面单独处理

    # #15：精度修正
    ("| 15 | 菜单别靠左，靠临近母菜单 | ⚠️ **只改了一半**", "PLACEHOLDER_15"),
]

for a, b in repl:
    if a is None:
        continue
    if a in t:
        t = t.replace(a, b, 1)

# #13 单独替换整行
line13 = next((l for l in t.splitlines() if l.startswith("| 13 |")), None)
if line13:
    t = t.replace(line13,
        "| 13 | 视图菜单最下面那条分隔线上移一行 | ✅ **确认无需改动**：用户给出的「正确分割」是 "
        "`…显示所有Take ┃ 时间轴显示设置.../主题:深色 ┃ 外观设置.../语言`，"
        "与模拟器截图 `0036` 的**现状完全一致**（4 条分隔线、分组相同）| A | DONE:09-24 |", 1)

# #15 单独替换整行
line15 = next((l for l in t.splitlines() if l.startswith("| 15 |")), None)
if line15:
    t = t.replace(line15,
        "| 15 | 菜单别靠左 | ✅ **已按澄清修好**（待验证）：① **放得下** ⇒ 左边界对齐母菜单**文字** —— "
        "差的就是 Trigger 的 `px-2`（8px），故 `alignOffset={-8}`；② **放不下** ⇒ 靠**右上角** —— "
        "`触发器的x + 460 > 视口宽` 时把 `align` 切成 `end`（最宽菜单粗估 460px），配合 "
        "`sticky=\"always\"` + `collisionPadding={8}` 保证不出屏。"
        "⚠️ `SubContent` **不支持 `align`**（子菜单位置由父菜单决定），只加了碰撞控制 | A | WIP |", 1)

# #16 关闭
line16 = next((l for l in t.splitlines() if l.startswith("| 16 |")), None)
if line16:
    t = t.replace(line16,
        "| 16 | 「动态」功能 | ✅ **已关闭**：用户查证 —— **原作者还没把这项功能推送到 GitHub**。"
        "与我这边的核实一致（基线 = 上游 develop HEAD；`main` 领先我们 0 个功能提交；"
        "i18n 与桌面版 exe 里都没有该功能名）| A | CLOSED:09-24 |", 1)

P.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新（5 已修 / 13 确认 / 15 修好 / 16 关闭）")
