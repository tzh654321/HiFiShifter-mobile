#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#1 收尾：更新 TASKS.md + memory。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

# ── ① TASKS.md 的 #1 ─────────────────────────────────────────────────────
T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = (
    "| 1 | 软件图标换成与电脑版一致 | ✅ 已生成 15 个 PNG + `mipmap-anydpi-v26` 自适应入口"
    "（底色 #17242C 取自图标）。脚本：`scripts/_gen-android-icons.py`、`_gen-adaptive-icon-xml.py`。"
    "**尚未持久化进 setup 脚本 + 未装机验证** | A | WIP |"
)
new = (
    "| 1 | 软件图标换成与电脑版一致 | ✅ **DONE（已持久化 + 已装机验证）**。"
    "15 个 PNG（5 密度 × 方形/圆形/前景）+ `mipmap-anydpi-v26` 自适应入口（含 monochrome），底色 #17242C。"
    "🕳️ **修复了一个静默失效**：setup 调的是 `gen-android-icons.py`（**无下划线**），文件却叫 `_gen-android-icons.py` "
    "⇒ 脚本不存在、被「`|| echo ⚠ 图标生成失败`」兜底吞掉 ⇒ **重放 setup 时图标从没重生成**（这就是「未持久化」的真因）。"
    "另：`_gen-adaptive-icon-xml.py`（自适应入口 + monochrome）压根没被 setup 调用。"
    "修法：去掉两个脚本名的下划线（本项目 `_` 前缀 = 一次性临时脚本，这俩是要随 setup 重放的正式脚本），"
    "setup 里两个都调、并去掉多余的源/目标参数（这俩脚本**路径全硬编码、不吃参数**，多传的参数会被静默忽略）。"
    "✅ **验证**：APK 内 `res/mipmap-*/ic_launcher*.png` + `mipmap-anydpi-v26/*.xml` 齐全；"
    "提取 xxxhdpi 图标目视 = 电脑版同款（#17242C 底 + 铅笔 + 曲线节点）；模拟器桌面快捷栏已显示 "
    "| A | DONE:09-27 01:44 |"
)
assert t.count(old) == 1, f"TASKS #1 锚命中 {t.count(old)} 次"
T.write_text(t.replace(old, new, 1), encoding="utf-8")
print("✓ TASKS.md #1 → DONE")

# ── ② memory ─────────────────────────────────────────────────────────────
M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #1 图标固化（01:20-01:44）—— 修掉一个**静默失效**

### 撞到的 bug

`setup-gen-android.sh` L103 调 `$ROOT/scripts/gen-android-icons.py`，
**但文件叫 `_gen-android-icons.py`（带下划线）** ⇒ **脚本根本不存在**。
那句以「`|| echo ⚠ 图标生成失败（不影响构建，沿用默认图标）`」兜底
⇒ **失败完全静默** ⇒ 每次重放 setup 都印「成功」，图标却从没被重生成。
（**这就是 #1 卡在「尚未持久化」的真因。**）
另：`_gen-adaptive-icon-xml.py`（自适应入口 + monochrome）**压根没被调用**。

### 修法

1. 去掉两个脚本名的下划线 —— 本项目惯例 `_` 前缀 = **一次性临时脚本**，
   这两个是**要随 setup 重放的正式脚本**，名字该正过来；
2. setup 里两个都调，并**去掉多余的源/目标参数**。
   这俩脚本**路径全硬编码**（`ROOT/upstream-src/backend/src-tauri/gen/android/...`）、**不吃参数** ——
   原写法多传了两个参数，**就算文件名对上也会被静默忽略**，是第二个隐患。

### 验证

| 项 | 结果 |
| :--- | :--- |
| 跑脚本 | ① 15 个 PNG（5 密度 × 方形/圆形/前景）② 2 个 XML + `values/colors.xml` |
| APK 内容 | `res/mipmap-{m,h,xh,xxh,xxxh}dpi-v4/ic_launcher{,_round,_foreground}.png` + `mipmap-anydpi-v26/*.xml` 齐全 |
| 图标正确性 | 提取 `mipmap-xxxhdpi-v4/ic_launcher.png` 目视 = 电脑版同款（#17242C 底 + 铅笔 + 曲线节点）|
| 装机 | 模拟器桌面快捷栏第 3 个图标即它（`docs/screenshots/0094`）|

⚠️ **通用教训**：**兜底的 `|| echo ⚠` 会把真错误吃掉**。
这次的发现纯属人工核对文件名 —— 凡是有「失败就降级」兜底的分支，
**首次接线时都该故意让它跑一次成功路径**，确认兜底没被误触发。
⚠️ 同轮又踩一次 **heredoc 写长文本** 导致 `SyntaxError`（memory 里早有记：「一律写成 `.py` 文件再跑」）。
""", encoding="utf-8")
print("✓ memory 已追加")
