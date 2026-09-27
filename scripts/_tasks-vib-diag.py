#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""更新 TASKS.md 的 #7（加入「vibrato 入口早已存在」的澄清 + 诊断日志）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| 7 |")), None)
assert old, "没找到 #7 行"

new = (
    "| 7 | 直线/颤音画完显示横纵两个滑动条（横=波长，纵=振幅），点空白确认关闭 | "
    "🟡 **代码完成 + 三个实测 bug 已修 + 已加诊断日志，等真机操作定位**。"
    "**已修**：① 曲线公式 `base + amplitude*sin(2π·freq·t)`，而 `vibratoStateRef` 初值 "
    "**`amplitude: 0`** ⇒ 拖波长时振幅仍为 0 ⇒ 还是直线 ⇒ **拖波长自动补可见默认振幅**；"
    "② 原来只在 `onChange` 落盘（异步、无即时反馈）⇒ 改**节流提交**（~60ms，松手立即补）；"
    "③ `AMP_MAX` 写死 1200（振幅单位是**值域单位**，对音高即半音）⇒ 改用 `currentParamRange`。"
    "**澄清**：`vibrato` 在手机上**早就有了入口** —— 铅笔按钮**右下角小三角 / 长按**出工具子菜单"
    "（`MobileBottomBar.tsx` L16/L565/L1277），之前判断「切不过去」是错的。"
    "⏳ **卡点**：我用 CDP 合成事件进不了 vibrato 模式（长按判不过），真机又**锁屏 + 连不上 CDP**，"
    "所以已加 `[HS-VIB]` 诊断日志（4 个打点：分支判定/提交回调/adjustReady effect/滑条回调），"
    "**请真机操作一次后读日志定位** | A | WIP:等真机日志 |"
)
t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ TASKS.md：#7 已更新（含入口澄清 + 诊断日志）")
