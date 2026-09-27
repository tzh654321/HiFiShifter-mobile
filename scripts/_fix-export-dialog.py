#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#6 导出音频界面：控件左边界左移 + 对话框右侧不再被切。

用户口径：「导出音频界面的控件左边界左移一些」。

模拟器实测（360×731）暴露了两件事：

1. **对话框右侧被裁** —— `Dialog.Content` 写死 `maxWidth: 760`，而视口只有 360，
   Radix 居中后左边留了 16px、右边**一点不剩**（实测 `dlgLeft=16 / dlgRight=360`），
   于是 `FLAC` 被切掉、「输出文件夹」的 `<ProjectFolde` 也截断。
   ⇒ 改成 `min(760px, calc(100vw - 32px))`，两侧各留 16px。

2. **控件列偏右** —— 标签列写死 `minWidth: 132`（本文件 15 处），在 360px 屏上
   占掉三分之一还多（实测标签在 x≈33、控件却在 x≈181，中间空了 148px）。
   ⇒ 压到 `88`，控件整体左移约 44px。

⚠️ 为什么改 inline `minWidth` 而不是用 CSS 断点覆盖：那些是**内联样式**，
普通 CSS 类压不住，得写 `!important` 且容易误伤全局 `.rt-Text`。
这个对话框是独立文件、样式又高度重复，批量改内联值更精准、也更可控。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "ExportAudioDialog.tsx")
t = P.read_text(encoding="utf-8")

# ① 标签列宽度 132 → 88
n = t.count("minWidth: 132")
assert n > 0, "找不到 minWidth: 132"
t = t.replace("minWidth: 132", "minWidth: 88")
print(f"✓ 标签列 minWidth 132 → 88（{n} 处）")

# ② 两个 Dialog.Content 的最大宽度改成"视口内留 16px"
a = """                <Dialog.Content
                    style={{ maxWidth: 760 }}"""
b = """                <Dialog.Content
                    // #6：不能只写死 760 —— 手机上视口才 360，Radix 居中后右侧会被切掉
                    // （实测 FLAC 按钮被裁、输出文件夹文字截断）。留两侧 16px。
                    style={{ maxWidth: "min(760px, calc(100vw - 32px))" }}"""
assert t.count(a) == 1, "主 Dialog.Content 锚不唯一"
t = t.replace(a, b, 1)

a2 = "<Dialog.Content style={{ maxWidth: 620 }}>"
b2 = '<Dialog.Content style={{ maxWidth: "min(620px, calc(100vw - 32px))" }}>'
assert t.count(a2) == 1, "冲突 Dialog.Content 锚不唯一"
t = t.replace(a2, b2, 1)
print("✓ 两个 Dialog.Content：maxWidth 改为 min(原值, calc(100vw - 32px))")

P.write_text(t, encoding="utf-8")
