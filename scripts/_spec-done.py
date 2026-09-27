#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：规格表落地 + 控制点改成两段式。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| **E 组完成度**")), None)
if old:
    t = t.replace(old, old + """

### 📋 规格表原文件已落地（2026-09-26）

`docs/临时.xlsx` 用 editor_sdk 读出 ⇒ 落成 **`docs/15-触屏交互规格表.md`**，
成为**唯一权威版本**（`0059-flm交互规格表.png` 只是它的截图，读图曾导致串列误判）。

**表末原注很重要**：**`-` 表示不做特殊处理而不是不做处理** —— 即 `-` 是"沿用默认行为"，
不是"手势没定义"。之前我把它当"无操作"理解，方向是对的但表述错了。

**核对结果**：8 条实现里 **7 条与规格一致**；**1 条需要修正** ——

| | 规格 | 我原先的实现 | 修正 |
| :--- | :--- | :--- | :--- |
| 控制点长按并划动 | **上划后再横滑**调淡入淡出；**下划后再横滑**调变速（**两段式**，上下方向各有语义）| 一次拖拽按"主导方向"二分（纵向 vs 横向）| ✅ 已改为**定型 + 锁定**：长按后纵向位移 ≥8px 即按方向锁定（上⇒fade / 下⇒stretch），**本次拖拽内不再翻转** |""", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md 已更新")

# MEMORY.md 记录规格表的权威位置
M = ROOT / ".workbuddy" / "memory" / "MEMORY.md"
if M.exists():
    mt = M.read_text(encoding="utf-8")
    if "15-触屏交互规格表" not in mt:
        anchor = "## 工具链 & 入口"
        if anchor in mt:
            mt = mt.replace(anchor, """## 触屏交互规格（唯一权威）

**`docs/15-触屏交互规格表.md`**（源自 `docs/临时.xlsx`，用 editor_sdk 读出）。
⚠️ `docs/screenshots/0059-flm交互规格表.png` **只是它的截图，别读图** ——
那张表 5 列且大量格子是 `-`，读图会串列（2026-09-26 因此误判过一轮）。

关键语义：**`-` = 不做特殊处理（沿用默认行为）**，不是"手势没定义"。

""" + anchor, 1)
            M.write_text(mt, encoding="utf-8")
            print("✓ MEMORY.md：记录规格表权威位置")
    else:
        print("  · MEMORY.md 已有")
else:
    print("  ⚠️ MEMORY.md 不存在")
