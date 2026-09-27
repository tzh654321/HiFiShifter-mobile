#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 C 盘满导致 Gradle 失败（同一个坑，第三次踩）。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## 🔴 C 盘满 ⇒ Gradle 失败（**同一个坑第三次踩**，20:50）

A5 改完后构建失败，日志：

```
Execution failed for task ':app:mergeUniversalDebugNativeLibs'.
   > ´ÅÅÌ¿Õ¼ä²»×ã¡£          ← GBK 乱码，解出来是「磁盘空间不足。」
BUILD FAILED in 46s
```

查 `df`：**C: 476G 已用、只剩 649M（100%）**。

### ⚠️ 问题在于：MEMORY.md 里**早就有**这条

> C 盘写满时症状是 gradle 任务里一句 **GBK 乱码的 IOException** —— **先 `df /c` 再查代码**。

**我还是先去看了日志里有没有编译错误。** 那句乱码本身就写在提示里，我盯着
`mergeUniversalDebugNativeLibs` 想"是不是原生库合并出问题了"。

⇒ **改法**：把这条从「环境」章节的普通一条，**升级到硬约定**里
（见下方 MEMORY.md 更新），并且**在看到的第一个 Gradle 失败时无条件先 `df /c`**。

### 清空间记录（都走 `truncate`，不进回收站）

| 目标 | 释放 |
| :--- | ---: |
| `~/.workbuddy/{traces,logs,workspace}`（735 个 >1MB 文件）| 4.04 GB |
| `%TEMP%` + `~/.workbuddy/workspace`（42 个 >5MB 文件）| 2.20 GB |
| `snapshots/default_boot/ram.img`（**需先关模拟器**）| 2.56 GB |

**`df` 变化**：649M → 820M → **3.4G**。

⚠️ 注意 `df` **不会立刻变**（NTFS 延迟）：截断 4GB 后 df 只涨了 171M，
可能一部分本来就已经是稀疏文件。**别因为 df 没变就以为 truncate 没生效。**

### 没敢动的

- `userdata-qemu.img.qcow2`（**8444MB**）—— **AVD 磁盘本体**，删了模拟器里的数据全没。
- ⚠️ 关模拟器会**丢掉当前 app 状态**（刚装好的 D4 包还在，但进程没了）；
  验证 A5 时要重开模拟器 + 重装。
""", encoding="utf-8")
print("✓ memory 已追加")
