#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第 4 条：双击轨道 = 展开编辑区。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 4 条：双击轨道 = 展开编辑区（手机）

### 根因：内核双击分支**全都依赖 `hit.clip`**

`timelineKernelHost.ts` 里双击统一在 `if (isDoubleClick)` 处理，逐个分支是
名称区（重命名）/ 增益旋钮（重置 0 dB）/ 增益·速率徽标（行内编辑）/ 其他（参数选区），
**每一个都从 `hit.clip` 出发** ⇒
**双击轨道空白处**（没命中块）根本落不到任何展开语义上。

### 做法：容器级补一次双击

在 `attachAxisSurfaces` 里，从 `host.getContainer()` 拿时间线容器，
挂一次 `dblclick`（**只在 `window.innerWidth < 600` 时生效**）⇒
`dispatch(showMobilePanel("params"))`。

⇒ 与音频块那条**同一出口**，所以手机端"双击块"与"双击轨道"结果一致 ——
这也正好对上规格表里这两列都写「展开全屏编辑」。

### ✅ 实测（模拟器 CDP）

```
双击前：params-off
在时间线容器上派发 dblclick
双击后：.hs-param-toolrow = 1（参数工具行出现）
        面板槽位 = 2（垂直分屏）        ✅
```

### 轨道列核对结果

| 手势 | 行为 | 现状 |
| :--- | :--- | :--- |
| 单击 | 切换轨道 | ✅ 已有 |
| **双击** | **展开全屏编辑** | ✅ **本步补齐** |
| 划动 | 平移视野 | ✅ 已有 |
| 长按 | 等待长按并划动 | ✅ 已有 |
| 长按并划动 | 右键框选 | ✅ 已有（`handleKernelBoxSelectToParamSelection`）|
| **双指单击** | **= 单击非选中轨道** | ⏳ **唯一待做** |

⇒ **四个区域核对完毕**：轨道头 ✅ / 音频块 ✅ / 轨道 ✅（差 1 条）/ 拍数栏（差长按变速）。

### 📌 一条贯穿全轮的规律

**上游把这套交互做得比清单看起来完整得多。** 四个区域逐条核对下来，
真正缺的是 **6 条**（轨道头左划 / 音频块双击 / 轨道双击 / 拍数栏双击 / 拍数栏长按变速 / 双指单击），
其余 15+ 条**本来就有**。

⇒ **"先核对再动手"是这轮最大的方法论收益**：
按清单盲做会重写一堆已有功能，而核对一次 `grep` 就能定位真正缺口。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| 其余条目（轨道列 / 拍数栏的长按变速、双指单击）| ⏳ 待落地；拍数栏变速需先扩内核接口 |"
if old in t:
    t = t.replace(old, """| **双击轨道 = 展开全屏编辑** | ✅ **已完成 + 实测通过**。根因：内核双击分支**全都依赖 `hit.clip`**（名称区/旋钮/徽标/块）⇒ **双击空白处没有落点**。⇒ 在 `host.getContainer()` 上补容器级 `dblclick`（仅 `<600px` 生效）⇒ `showMobilePanel("params")`，与音频块同一出口。实测：双击前 `params-off` → 双击后 `.hs-param-toolrow = 1`、面板槽位 = 2 ✅ |
| **四区域核对结论** | 轨道头 ✅全齐 · 音频块 ✅全齐 · 轨道 ✅（差「双指单击」1 条）· 拍数栏（差「长按变速」，**需先扩内核接口**）。**上游完整度远超清单观感：20+ 条里真正缺的只有 6 条** |
| 剩余待做 | ① 拍数栏长按变速（扩接口）② 「双指单击 = 单击非选中轨道」|""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组 4/21 + 四区域核对结论")
