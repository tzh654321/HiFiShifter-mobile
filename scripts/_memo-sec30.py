#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #6 完成 + #10 的查证结论，并更新 TASKS.md。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉚ #6 导出音频界面（完成）+ #10 参数选区的查证

### #6：模拟器实测暴露了两件事，不是一个

用户只说「**控件左边界左移一些**」，但用 CDP 量了一遍发现**右侧还在被裁**：

| 指标 | 修正前 | 修正后 |
| :--- | ---: | ---: |
| 对话框左 / 右 | 16 / **360**（=视口右边界，右侧零留白）| 16 / 358 |
| 下拉框左边界 | **181** | **137**（左移 44px）|
| `FLAC` 按钮 | **被裁** | 完整 |
| `<ProjectFolder>` | **截断成 `<ProjectFolde`** | 完整 |

两处根因：
1. `Dialog.Content` 写死 `maxWidth: 760`，而视口只有 360 ⇒ Radix 居中后左边留 16px、
   **右边一点不剩**。改成 `min(760px, calc(100vw - 32px))`。
2. 标签列写死 `minWidth: 132`（**16 处**），360px 屏上占掉三分之一多 ⇒ 控件被挤到 x=181。
   压到 `88`。

⚠️ 为什么改 inline 值而不是加 CSS 断点：那些是**内联样式**，普通类压不住，
得 `!important` 且容易误伤全局 `.rt-Text`。这个对话框独立成文件、样式高度重复，批量改更精准。

### #10 参数选区：**是 beta.14 的新功能，手机上真的不可用**

查证结论（回答用户的两个问题）：

- **是新版功能吗** ⇒ **是**。`kb_modifier_clip_range_to_param_selection` 的文案是
  「音频块范围加入参数选区（**按住右键单击音频块**）」，配套右键菜单项
  `ctx_add_to_param_selection`（`ClipContextMenu.tsx:873`）。这与上游 beta.14 的
  「参数编辑器同步时间轴」一脉相承。
- **为什么不可用** ⇒ **触发方式是「按住右键单击」，而手机没有右键**。
  代码上长按菜单**应该**有这一项（`onAddToParamSelection` 在 `TimelinePanel.tsx:6305`
  是**无条件传递**的），但它派发的 `hifi:editOp / addClipsToParamSelection`
  由 `PianoRollPanel` 消费 —— **参数编辑器没打开时点了不会有任何反应**，
  这很可能就是用户感知到的"不可用"。

⇒ **需要用户确认现象**：长按音频块，菜单里**有没有**「范围加入参数选区」这一项？
   有 → 是"点了没反应"（要补移动端入口/启用条件）；
   没有 → 是回调没传到移动端那条渲染路径（**参考 #15 的教训：先确认渲染路径**）。

（顺手推了一个 3 秒 440Hz 测试音频到模拟器
`/storage/emulated/0/HiFiShifter/hs_test_tone.wav`，方便验证导入与 SAF。）
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉚ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")

line6 = next((l for l in t.splitlines() if l.startswith("| 6 |")), None)
if line6:
    t = t.replace(line6,
        "| 6 | 导出音频界面控件左边界左移 | ✅ **已完成并量化验证**。实测发现**两个**问题："
        "① `Dialog.Content` 写死 `maxWidth:760` ⇒ 360px 屏上右侧零留白、`FLAC` 被裁、"
        "`<ProjectFolder>` 截断 ⇒ 改 `min(760px, calc(100vw−32px))`；"
        "② 标签列 `minWidth:132`（16 处）把控件挤到 x=181 ⇒ 压到 88。"
        "**下拉框左 181 → 137（左移 44px）**，右侧不再裁切 | A | DONE:09-24 |", 1)

line10 = next((l for l in t.splitlines() if l.startswith("| 10 |")), None)
if line10:
    t = t.replace(line10,
        "| 10 | 「音频时间范围加入参数选区」不可用 | ✅ **查证完成**：**是 beta.14 的新功能**"
        "（文案「音频块范围加入参数选区（**按住右键单击音频块**）」+ 右键菜单项）。"
        "不可用的原因：**触发方式是「按住右键」，手机没有右键**；且它派发的 "
        "`hifi:editOp/addClipsToParamSelection` 由 `PianoRollPanel` 消费 ⇒ "
        "**参数编辑器没打开时点了没反应**。🟡 **待用户确认现象**：长按音频块，"
        "菜单里到底「有没有」这一项？（决定是补移动端入口，还是渲染路径问题——"
        "参考 #15 的教训，先确认渲染路径）| A | BLOCKED:待确认 |", 1)

T.write_text(t, encoding="utf-8")
print("✓ TASKS.md： #6 DONE / #10 待用户确认")
