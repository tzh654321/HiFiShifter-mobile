#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录「C 盘写满阻塞构建」这一次。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## C 盘写满再次阻塞构建（2026-09-25 晚）

### 症状

`build-apk.sh x86_64` 在 `:app:packageUniversalDebug` 失败：

```
java.io.IOException: ´ÅÅÌ¿Õ¼ä²»×ã¡£
```

那串是 **GBK 被当 Latin-1 解码**的乱码，原文 = **`磁盘空间不足。`**
（memory 里早有记录，但这次是**又一次**撞上 —— 说明这条该更早检查。）

⇒ **新习惯**：`build-apk.sh` 失败且错误里有**看不懂的乱码**时，
**第一件事 `df -h /c /d`**，别去翻代码。

### 实测（2026-09-25 22:30）

```
C:  476G  已用 476G  可用 0    100%    ← 0 字节可用
D:  932G  已用 856G  可用 76G   92%
```

| 目标 | 体积 | 说明 |
| :--- | ---: | :--- |
| `~/.android/avd/hs-phone-tall.avd` | **9.0G** | 正在用的模拟器，**不能删** |
| `~/.android/avd/hs-tablet{,2}.avd` | 10K | 已是空的（之前清过）|
| `%LOCALAPPDATA%\\Temp` | **1.9G** | 可截断 |
| `C:\\$Recycle.Bin` | **3.6G** | **清空即释放** |
| `~/.gradle` | 3.6G | 缓存，可截断（会重下）|
| `~/.workbuddy` | 5.2G | 工具自身 |

### 解法（真释放空间的两条路）

⚠️ 本机**删除一律进回收站、不释放空间**；要真释放只有：

1. **`Clear-RecycleBin -Force`** —— 一次释放 3.6G（异步，可能几分钟后才见效）
2. **`find <dir> -type f -exec truncate -s 0 {} \\;`** —— 截断 ≠ 删除、不进桶

⇒ 清空回收站 + 截断 Temp ≈ **5.5G**，足够一次 APK 构建。

### 教训

**这个项目在 C 盘上的可用空间长期是个位数 GB**，
每次大构建（尤其 `--force` 全量 tsc + gradle package）都可能把它压到 0。
⇒ **构建前先 `df /c`** 应该变成和 `verify-patches.sh` 一样的习惯动作。
""", encoding="utf-8")
print("✓ memory 已追加")
