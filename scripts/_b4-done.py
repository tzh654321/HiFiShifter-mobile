#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4 机制验证通过 + 记录。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊿ B4 机制验证通过：拖到边缘 ⇒ 自动切页

### 补上的第二半：切页后的**指针接管**

`useTimelineDragDrop.onHifiFileDrag` 是**被动接收方** —— 只处理
`FileBrowserPanel` 派发来的 `start / move / duration`，自己不挂 pointer 监听。
⇒ 切页会卸载文件面板，**没人再派发 move**，拖拽停在中途。

解法（`App.tsx`）：派发 `hs-mobile-switch-tab` 的那一刻就知道"要过页"，
此时挂上 window 的 `pointermove / pointerup`，**替文件面板继续派发 `hifi-file-drag`**
（`move` / `drop`）直到抬手。上下文（路径、文件名）由文件面板在 `start` 时
写进 `window.__hsDragPayload`。

⇒ 完整链路：

```
文件面板 pointerdown（阈值内不起拖）
  → 超过 DRAG_THRESHOLD ⇒ 写 __hsDragPayload + 派发 start
  → 拖到边缘 56px 内停 400ms ⇒ 派发 hs-mobile-switch-tab
  → App 切页 + **接管 pointer**（继续派发 move）
  → 轨道窗 useTimelineDragDrop 收 move ⇒ 落点预览
  → 抬手 ⇒ 派发 drop ⇒ importAudioAtPosition
```

### ✅ 验证（模拟器 CDP）

派发 `hs-mobile-switch-tab {tab:"timeline"}` 后截图确认：底部「**轨道**」页签高亮
⇒ 切页机制生效 ✅。`__hsDragPayload` 槽位读写正常 ✅。

⚠️ **未能端到端验证的部分**：文件页当前是空的（模拟器里没测试音频），
所以"从真实文件条目起拖 → 拖到边缘 → 松手落到轨道"这条完整路径**需要真机+有音频时手测**。

### 本轮小结

B4 这个需求**最大的价值不是写代码，而是先读代码** ——
拖放链路（`hifi-file-drag` ⇒ `useTimelineDragDrop` ⇒ `importAudioAtPosition`）**早就存在**，
桌面能用。真正缺的是"**手机单面板下拖不过去**"这层应用形态问题。
如果一上来就写拖放，会造出一套和现有事件机制冲突的东西。
""", encoding="utf-8")
print("✓ memory ㊿ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| B4 |")), None)
if old:
    t = t.replace(old,
        "| B4 | 文件浏览器长按音频拖到轨道窗 | 🟢 **机制已打通并验证**。"
        "① 拖放链路本已存在（`hifi-file-drag` ⇒ `useTimelineDragDrop` / `PianoRollPanel` ⇒ "
        "`importAudioAtPosition`），**桌面可用**；② 真正的障碍是**手机单面板**："
        "文件页显示时轨道页未渲染 ⇒ 已加「**拖到屏幕边缘 56px 停 400ms ⇒ 自动切到轨道页**」"
        "（`hs-mobile-switch-tab` window 事件桥）；③ 切页会卸载文件面板 ⇒ `onHifiFileDrag` 是**被动接收方**，"
        "无人派发 move ⇒ 由 **App 接管 pointer**（`pointermove/up` 继续派发 `hifi-file-drag`），"
        "上下文经 `window.__hsDragPayload` 传递。"
        "**验证**：CDP 派发切页事件后页签确实切到「轨道」✅。"
        "⚠️ 文件页为空，**完整拖放路径需真机+音频手测** |", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：B4 已更新")
else:
    print("· 没找到 B4 行")
