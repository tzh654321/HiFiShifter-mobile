#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第 5 条：双指单击 = 单击非选中轨道。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## E 组第 5 条：双指单击 = 单击非选中轨道

### 为什么不改手势层

`touchGesture.ts`（`TwoFingerGestureController`）是**双指缩放/平移的核心状态机**，
里面**没有任何 tap 概念**，而且它被多个表面共用（拍数栏 / 轨道列 / 参数区）。
往里加 tap 判定 = 动核心状态机，风险与收益不成比例。

⇒ 改用**独立监听**：在时间线容器上自己数指针 ——

- 两指都按下、`pointerType !== "mouse"`；
- **每指位移都 ≤ 12px**（有人动过就作废，那是缩放/平移）；
- 两指都抬起且**总时长 ≤ 300ms**；
- ⇒ 判定双指 tap，按 `resolveTrackIdAtClientY(e.clientY)` 命中轨道后 `handleSelectTrack`。

### ⚠️ 未做运行时验证

构建成功，但 **C 盘只剩 323M**，`adb install` 没跑完就断了（磁盘）。
已过 tsc，**待磁盘清理后验证**。

### 磁盘状况（持续问题）

```
C:  476G  已用 476G  可用 323M  100%
```

整轮下来 C 盘从 3.6G 一路掉到 323M —— **每次全量构建约吃 1~2G**。
⇒ **这是本项目的长期瓶颈**，建议：
1. 清空回收站（每次构建产生的旧产物都进桶，只增不减）；
2. 截断 `~/.gradle/caches`（3.6G，会重新下载）；
3. 考虑把 gradle 的 user home 也挪到 D 盘（`GRADLE_USER_HOME`）。

---

## ✅ E 组总结（四个区域核对完毕）

按规格表 4 个区域 × 6 类手势 = 24 格，**逐条核对后真正缺的只有 6 条**：

| # | 条目 | 状态 |
| :-- | :--- | :--- |
| 1 | 拍数栏双击 = 移动进度条并开始播放 | ✅ 代码完成，待运行时验证 |
| 2 | 轨道头左划 = 隐藏/展开轨道头 | ✅ **实测通过**（折叠+展开） |
| 3 | 双击音频块 = 展开编辑区 | ✅ 代码完成 |
| 4 | 双击轨道 = 展开编辑区 | ✅ **实测通过** |
| 5 | 双指单击 = 单击非选中轨道 | ✅ 代码完成，**待磁盘清理后验证** |
| 6 | 拍数栏长按变速 | ⏳ **需先扩内核接口**（`TimelineKernelHost` 没暴露 `getPxPerSec`/`setHorizontal`）|

### 🔑 方法论收获（这条最值钱）

**上游把这套交互做得远比清单看起来完整。** 24 格里 18 格**本来就有**
（单击选中、拖动块、长按菜单、框选、平移、缩放、换序、重命名……）。

⇒ **"先核对再动手"**：按清单盲做会重写一堆已有功能，
而核对一次 `grep` + 一次 CDP DOM 查询就能定位真正缺口。
本轮 6 条里 4 条是**一两行**的事（多数只需"把已有能力接到另一个入口"）。

### 📌 关于 canvas 与 DOM 的边界（本轮第二次遇到）

**内核渲染的内容（音频块、波形、网格）没有 DOM 节点** ——
`grep data-clip-id` 只命中 `FadeHitLayer`（淡入淡出的命中层，另一回事）。
⇒ 涉及音频块的交互**只能走内核回调**；拍数栏、工具栏、外框才是真 DOM，
可以 `addEventListener`。**动手前先确认这条，能省一轮返工。**
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "| 剩余待做 | ① 拍数栏长按变速（扩接口）② 「双指单击 = 单击非选中轨道」|"
if old in t:
    t = t.replace(old, """| **双指单击 = 单击非选中轨道** | ✅ **代码完成**（tsc 过）。⚠️ **不改手势层** —— `touchGesture.ts` 是双指缩放/平移的核心状态机且被多个表面共用；改用**独立监听**：两指都按下、每指位移 ≤12px、总时长 ≤300ms ⇒ 判定 tap ⇒ `resolveTrackIdAtClientY` 命中后 `handleSelectTrack`。**待磁盘清理后运行时验证**（C 盘只剩 323M，装机中断）|
| 剩余待做 | ① 拍数栏长按变速（**需先扩内核接口**）② 上述 3 条待运行时验证 |""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：E 组 5/6")
