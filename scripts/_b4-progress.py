#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4 进展记录（含发现的衔接问题）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊾ B4 进展：拖放链路本来就有，缺的是"手机上过不去"

### 读代码得到的事实

完整链路**早已存在**：

```
FileBrowserPanel.handlePointerDownForDrag      ← 起拖（DRAG_THRESHOLD）
  └─ window.dispatchEvent(CustomEvent("hifi-file-drag"))      ← L503/521/555/574/597 共 5 处
       └─ useTimelineDragDrop.ts:567   addEventListener("hifi-file-drag", onHifiFileDrag)
       └─ PianoRollPanel.tsx:1087      addEventListener("hifi-file-drag", onHifiFileDrag)
            └─ importAudioAtPosition / importMultipleAudioAtPosition
```

⇒ **桌面拖放是能用的**。用户要的"要支持"，实质是**手机上不行**。

### 🔴 真正的障碍：手机是**单面板**

`App.tsx:3991`：手机用 `BottomTabs` 在 `轨道/参数/文件/笔记` 间**互斥切换**
（`mobileTab` 是 App 的局部 state）。**文件页显示时轨道页根本没渲染** ⇒
指针无论怎么拖都落不到轨道容器上。

### 本轮做法：拖到屏幕边缘 ⇒ 自动切页

1. `App.tsx`：监听 `window` 的 `hs-mobile-switch-tab` ⇒ `setMobileTab(...)`
   （`mobileTab` 是局部 state，外部够不着，所以走 window 事件桥）。
2. `FileBrowserPanel`：拖拽激活后，指针停**左右边缘 56px 内超过 400ms** ⇒ 派发切页事件。
   ⚠️ 400ms 停留判定是防误触（手指划过边缘不该切页）。

### ⚠️ 已知衔接问题（下一步要解决）

**切页会让 `FileBrowserPanel` 卸载** ⇒ 它的 `dragState` 和后续的 `pointermove/up`
监听一起没了 ⇒ 拖拽可能**中途断掉**，手指松开时轨道窗收不到落点。

⇒ 解法方向：让**轨道窗在收到 `hifi-file-drag` 后接管后续 pointer 跟踪**
（自己挂 window 的 move/up，而不是依赖文件面板继续派发）。
这需要读 `useTimelineDragDrop` 的 `onHifiFileDrag` 现状再改。

### 教训

**先读代码再动手**。我一开始准备从零写一套拖放，读了才发现链路齐备 ——
真正的问题在**应用形态**（单面板）而不是拖放实现本身。
如果一开始就写，会重复造一套和现有 `hifi-file-drag` 冲突的机制。
""", encoding="utf-8")
print("✓ memory ㊾ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| B4 |")), None)
if old:
    t = t.replace(old,
        "| B4 | 文件浏览器长按音频拖到轨道窗 | 🟡 **链路本已存在**（`FileBrowserPanel` 派发 "
        "`hifi-file-drag` ⇒ `useTimelineDragDrop`/`PianoRollPanel` 监听 ⇒ `importAudioAtPosition`），"
        "**桌面可用**。真正的障碍是**手机单面板**：文件页显示时轨道页没渲染，拖不过去。"
        "⇒ 已加「**拖到屏幕边缘 400ms ⇒ 自动切到轨道页**」（`hs-mobile-switch-tab` window 事件桥）。"
        "⚠️ **待解决**：切页会卸载文件面板 ⇒ `dragState` 与后续 move/up 监听一起丢失，"
        "拖拽可能中途断。需让轨道窗在收到 `hifi-file-drag` 后**自己接管 pointer 跟踪** |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：B4 进度已更新")
else:
    print("· 没找到 B4 行")
