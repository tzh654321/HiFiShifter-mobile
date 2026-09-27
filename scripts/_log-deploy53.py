#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #53 修正包已部署真机 + MEMORY.md 整理。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

## ✅ #53 修正包已部署真机（07:40）

真机 `221deeb` **07:34 左右回来了**（`adb devices` 完整输出可见；
⚠️ 再次印证：**判设备在不在必须看完整输出**）。

流程跑通了，而且**新的 ABI 自检在真实场景生效**：

```
bash scripts/check-apk-abi.sh D:/hifishifter-out/hifishifter-arm64-v8a-debug.apk 221deeb
  ⇒ ✅ 匹配：包内含 arm64-v8a，设备主 ABI 也是 arm64-v8a —— 可以装
push ⇒ pm install -r -t ⇒ Success
启动 ⇒ PID=21495，files/media/test.wav 仍在（pm install -r 保留数据）
```

⚠️ **一个「看起来像误报、其实是对的」的事**：我构建 x86_64 包时，第 ⑩ 步报了
「不匹配，包内只有 arm64-v8a」—— 当时我怀疑是 bug，查完发现 **`FIRST_DEV` 取到了真机
`221deeb`（arm64）**，而刚构建的是 x86_64 包 ⇒ **脚本判断完全正确**。
⇒ **多设备时第 ⑩ 步会拿"第一个在线设备"比对**，若它与你目标设备不同，报告会"看着别扭但正确"。
（要精确比对，直接手跑 `check-apk-abi.sh <apk> <目标 serial>`。）

## ✅ MEMORY.md 整理（07:37）

原文 244 行 / ~12KB，且被注入阶段截断。做了一次结构重排：

- **「硬约定」提到最前**（原来第 1 条就混着 4 个子坑）；
- **新增两条今天踩的硬约定**：
  - **#10**：`[ X ] && cmd` 在 `set -e` 下是雷（条件假 ⇒ 返回 1 ⇒ 静默退出）；
    命令替换要 `|| true`；**验退出码不能接管道**（拿到的是 `tail` 的）。
  - **#11**：`app-universal-debug.apk` 是**共用路径** ⇒ 装机只用带 ABI 的归档包；
    跨 ABI 会走转译 ⇒ onnxruntime JIT SIGSEGV **而崩前日志正常**（先看
    `DEBUG: Guest architecture`，别先看代码）。
- **新增 docs/10 卡点 8/9**：真机喂测试音频的 PC-桥法；参数编辑器两种模式。
- **环境章节**补齐今天实测的大户：`~/.workbuddy/workspace`(2.7GB)、
  `ram.img`(2.5GB，模拟器关后可截断)。
- **待办精简为 12 条** + 新增「已收口，别再排」区块（把外观设置、arm64 打包失败、
  `swap-so-in-apk.py`、`repack-apk.sh`、A/B/E 组 24 格等已完成项一次性钉死，
  防止以后又把已解决的事排回列表）。

⚠️ **字符数没有下降**（~21K vs 原 12K）—— 因为删掉的旧项少、补进去的新坑多，
且新内容都是"违反必出事"级别的。**有意为之**：宁可长，也不要下次再踩。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #53 修正包已部署真机（2026-09-27 07:40）

真机 `221deeb` 07:34 回来 ⇒ **新 ABI 自检在真实场景生效**：

```
check-apk-abi.sh ...arm64-v8a-debug.apk 221deeb
  ⇒ ✅ 匹配：包内含 arm64-v8a，设备主 ABI 也是 arm64-v8a
push + pm install -r -t ⇒ Success ⇒ PID=21495（数据保留，test.wav 仍在）
```

⚠️ **"看起来像误报、其实是对的"**：构建 x86_64 时第 ⑩ 步报「不匹配，包内只有 arm64-v8a」——
查完发现 `FIRST_DEV` 取到了真机（arm64）⇒ **脚本判断正确**。
⇒ 多设备时第 ⑩ 步拿"第一个在线设备"比对；要精确比对请手跑 `check-apk-abi.sh <apk> <serial>`。

### ✅ MEMORY.md 整理（2026-09-27 07:37）

结构重排：**「硬约定」提到最前**；**新增两条硬约定**
（#10 `set -e` 雷 · #11 ABI 覆盖坑）；新增 docs/10 卡点 8/9（真机喂音频的 PC 桥法、
参数编辑器两种模式）；补 `~/.workbuddy/workspace`(2.7G) 与 `ram.img`(2.5G) 两个大户；
待办精简为 12 条 + 新增「**已收口，别再排**」区块钉死已完成项。

🔴 **待用户说明**：8 条触屏手势他反馈"有问题"，具体现象待他描述。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
