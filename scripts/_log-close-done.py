#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：关闭键三条指示全部落实 + 真机掉线。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ✅ 关闭键：按用户三条指示重做（实测全过）

| 用户要求 | 实现 | 实测 |
| :--- | :--- | :--- |
| **放左上角**（否掉了我上一轮的右上角）| `.hs-panel-close { top:2px; left:2px }` | `x=2, y=88 / y=378` ✅ |
| **无底色、无边框** | `background: transparent; border: none` | `bg: rgba(0,0,0,0)`、`bw: 0px` ✅ |
| **菜单打开时不得挡在前面**（视觉+触控）| `body:has([role="menu"]) .hs-panel-close { pointer-events:none; opacity:.15 }` | `pe: none`、`op: 0.15`、`z: 20` ✅ |

### 🔑 "让开"这条的做法

关键是**两个维度都要处理**：
- **视觉** ⇒ `z-index` 只给 **20**（Radix 浮层 portal 到 body，z-index 远高于此）
  —— **绝不能用大值去压菜单**；
- **触控** ⇒ 菜单开启时 `pointer-events: none`
  ⇒ 点菜单时**绝不会误触到关闭键**。

判据用 `body:has([role="menu"])` —— `:has()` 从 Chrome 105 起支持，
本项目 WebView 是系统版（Android 14 上是 Chromium 1xx）⇒ 可用。

### ⚠️ 左上角的已知代价（待真机观察）

时间线面板左上角 = **拍数栏起点**（点它 = seek），参数面板左上角 = **钢琴键列表顶端**。
26px→24px 的 ✕ 放那儿会：
- 挡住一点点内容；
- **与"点拍数栏 seek"抢点击**。

⇒ 缓解：尺寸压到 **24×24**、半透明（`rgba(229,231,235,.75)`）、`top/left 2px`。
**真机试用若发现抢点击，需要给拍数栏让出这一点（或把 X 挪到面板标题行）。**

## ⚠️ 真机掉线

`adb devices` 只剩 `emulator-5554`，`221deeb` **不在了**（USB/WiFi 断）。
`kill-server` + `start-server` 也没恢复 ⇒ **属于物理断连，只能等重新接上**。
arm64 APK 已构建好并在 `D:/hifishifter-out/` 归档，接上即可安装。
""", encoding="utf-8")
print("✓ memory 已追加")
