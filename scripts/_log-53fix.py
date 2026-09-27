#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #53 修正 + ABI 自检脚本。"""
from pathlib import Path

M = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\.workbuddy\memory\2026-09-22.md")
M.write_text(M.read_text(encoding="utf-8") + """

## #53 修正 + 新增 ABI 自检脚本（07:03-07:20）

### 用户反馈

> 「#7 #10 正常；**#53 波长的数值我怀疑算错了，振幅不用写单位**；
> #11 暂时不测；其余 8 条有问题」

### #53 的修正

**振幅**：去掉「半音」单位 ⇒ 只显示 `±1.23`
（保留 `±`：那是**正负号语义**，不是单位）。

**波长**：核对后发现**两个问题**：

1. 🔴 **帧数少算 1 帧** —— `buildVibratoDense` 的采样循环是
   `for (f = minF; f <= maxF; f++)`（**闭区间**）⇒ 实际有
   **`endFrame - startFrame + 1`** 个帧，而我原来写的是 `endFrame - startFrame`。
   48k 下差 0.021ms（肉眼不可见），但**算错就是算错**，周期小时相对误差会放大。
   ⇒ 已改为 `len = Math.abs(endFrame - startFrame) + 1`。
2. ⚠️ **采样率核实了**：`projectSampleRate` 在**全项目没有任何调用方传值**
   （`timelineSnapping.ts` 里它只出现在 `?? DEFAULT_PROJECT_SAMPLE_RATE`）
   ⇒ 实际恒为 **48000**，用默认常量是**对的**（这点我先怀疑错了）。

⚠️ 显示格式：数值栏只有 **40px**，「0.1250 s / 8 周期」装不下
⇒ 只给 `0.1250 s`（4 位小数）。

### 参数编辑器的两种模式（重要）

- **轨道模式**：音高 / 共振峰 / 气声 / 张力 / 音量 / 声像 / 算法
- **音符模式**：颤音（**波长 / 振幅**）← **#53 / #7 在这里**

⚠️ **`set_param_editor_mode` 不是后端命令**（模式是纯前端状态）⇒ CDP 切不了模式。

### 新增 `scripts/check-apk-abi.sh`

**动机**：今天踩的 ABI 覆盖坑（arm64 包装进 x86_64 模拟器 ⇒ ONNX JIT 崩）
应该**在装机前就被拦住**，而不是靠人记得。

```bash
bash scripts/check-apk-abi.sh <apk> [serial]   # 比对包内 ABI 与设备主 ABI
bash scripts/check-apk-abi.sh --device <serial> # 只问设备该用哪个包
```

- 用 Python 读 ZIP 中央目录取 `lib/<abi>/` 集合（不依赖 `unzip`）；
- 不匹配时**退出码 1** + 打印「会走 ABI 转译 ⇒ JIT 极可能 SIGSEGV」+ 给出该用哪个包；
- 结尾提醒「别用 `app-universal-debug.apk`，那是共用路径、ABI 取决于最后一次构建」。

✅ 实测：arm64 包正确识别出 `含 ABI: arm64-v8a`。

### 真机掉线（07:03）

部署第二轮 arm64 包时真机**真的掉了**（`adb: device '221deeb' not found`，
`adb devices` 列表为空）⇒ **这次不是 `tail` 截断**，是真离线。
⇒ 包已构建好（`D:/hifishifter-out/hifishifter-arm64-v8a-debug.apk`，含 #53 修正），
**等真机回来再装**。
""", encoding="utf-8")
print("✓ memory 已追加")

T = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\TASKS.md")
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #53 修正（2026-09-27 07:20，用户反馈）

用户：「**#7 #10 正常；#53 波长的数值我怀疑算错了，振幅不用写单位**；#11 暂时不测」。

**振幅** ⇒ 去掉「半音」单位，只显示 `±1.23`（`±` 是正负号语义，不是单位）。

**波长** ⇒ 核对后发现：
1. 🔴 **帧数少算 1 帧** —— `buildVibratoDense` 的循环是 `f <= maxF`（**闭区间**）
   ⇒ 实际 `endFrame - startFrame + 1` 个帧。已改为 `len = |endFrame-startFrame| + 1`。
2. ✅ **采样率核实：48000 是对的** —— `projectSampleRate` 全项目没人传值
   （只在 `?? DEFAULT_PROJECT_SAMPLE_RATE` 出现）⇒ 恒为默认值。

⚠️ 数值栏仅 40px，「0.1250 s / 8 周期」装不下 ⇒ 只给 `0.1250 s`。

✅ tsc 通过 · 补丁 regen + verify 通过（72 文件逐字节一致）· arm64 包已构建。
🟡 **待装真机** —— 真机 07:03 掉线（`device not found`，这次是真离线）。

### ✅ 新增 `scripts/check-apk-abi.sh`（防 ABI 覆盖坑）

```bash
bash scripts/check-apk-abi.sh <apk> [serial]    # 比对包内 ABI 与设备主 ABI
bash scripts/check-apk-abi.sh --device <serial> # 问该用哪个包
```

不匹配 ⇒ **退出码 1** + 说明「会走 ABI 转译 ⇒ JIT 极可能 SIGSEGV」+ 给出正确包名。
✅ 实测 arm64 包正确识别。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
