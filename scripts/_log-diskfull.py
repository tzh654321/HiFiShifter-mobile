#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 A5 构建时的磁盘满事故。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## 🔴 A5 构建失败 = **C 盘再次写满**（20:10-20:25）

### 症状（这次比上次更隐蔽）

`build-apk.sh x86_64` **exit 1**，日志尾部只有：

```
FAILURE: Build failed with an exception.
* What went wrong:
Execution failed for task ':app:mergeUniversalDebugNativeLibs'.
> ´ÅÅÌ¿Õ¼ä²»×ã¡£          ← 这是 **GBK 乱码**，解码 = 「磁盘空间不足。」
```

⚠️ **误导点**：任务名是 `mergeUniversalDebugNativeLibs`（**原生库合并**），
第一反应会去查 **memory 里那条"原生库被截成 0 字节 / symlink 退化"** ——
**完全错方向**。真凶是那行乱码。

⇒ **解乱码才看得出是磁盘**：
`´ÅÅÌ¿Õ¼ä²»×ã¡£` = 磁盘空间不足。

**教训**：`build-apk.sh` 失败时，**先看有没有 GBK 乱码行**，再看任务名。
（MEMORY.md 早写了这条，但我这次还是先顺着任务名想错了方向 —— 说明
 **"看到 mergeNativeLibs 先想 symlink"和"先解乱码"要并列写在一起**。）

### 处置

| 目标 | 释放 |
| :--- | ---: |
| `~/.workbuddy/workspace`（>5MB 的备份）+ `~/.cargo/registry/cache` | 0.13 GB |
| **`ram.img`**（**先 `adb emu kill`**，再 truncate 2560 → 0 MB）| 2.50 GB |
| `~/.gradle/caches` 里 >2MB 的文件（126 个，可重建）| 1.77 GB |
| **合计** | **≈ 4.4 GB** |

C 盘 **0 → 4.4G**。⚠️ 清 gradle caches 会让**下次构建变慢**（要重下依赖）。

### C 盘的真实构成（下次直接照这个顺序清）

```
~/.android            10.96 GB   ← 大头！其中 userdata-qemu.img.qcow2 8.46 GB（AVD 磁盘本体，删=丢数据）
~/.gradle              2.68 GB   ← caches 大部分可重建
~/.workbuddy/workspace 2.31 GB   ← 会话备份，可截断
~/.cargo               2.26 GB   ← registry/cache 可重下
%TEMP%                 0.04 GB   ← 已经清过，不是大头
```

⚠️ **`~/.android` 占 11GB 是根本矛盾**：AVD 磁盘本体 8.46GB 不该动（会造成 AVD 数据全丢），
但**每次构建前都要先腾 4GB** 也很别扭。
⇒ **建议**（需用户决定）：把 `ANDROID_AVD_HOME` 指到 D 盘，或干脆少用模拟器（真机优先）。
""", encoding="utf-8")
print("✓ memory 已追加")
