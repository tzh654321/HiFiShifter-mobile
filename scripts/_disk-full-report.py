#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C 盘写满导致构建失败 —— 现状与清理建议（只报告，不执行任何删除）。

## 症状

`build-apk.sh x86_64` 在 `:app:packageUniversalDebug` 阶段失败：

```
java.io.IOException: ´ÅÅÌ¿Õ¼ä²»×ã¡£
```

那串是 **GBK 解码成 Latin-1 的乱码**，原文是 **`磁盘空间不足。`**
（memory 里早有记录：*"C 盘写满时症状是 gradle 任务里一句 GBK 乱码的
java.io.IOException: 磁盘空间不足 —— 先 `df /c` 再查代码"*）

## 实测

```
C:  476G  已用 476G  可用 0    100%     ← 0 字节可用
D:  932G  已用 856G  可用 76G   92%
```

C 盘大户：`.android` 9.0G（AVD）· `.workbuddy` 5.2G · `.gradle` 3.6G

## 为什么不能"随便删"

本项目环境有两条硬约束（memory 记录）：

1. **删除一律进回收站**，且拦截在脚本宿主之下（子进程 / 原生 cmdlet / .NET API 全走回收站）
   ⇒ **不释放空间**。
2. **真释放空间只有 `truncate -s 0`** —— 截断 ≠ 删除，不进桶。

⇒ 下面给的是**截断**方案（真释放），但**由你决定执行哪些**。
"""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parent.parent

print(__doc__)
print("=" * 78)

# ── ① 直接报出可安全截断的目标（只列出、不执行）─────────────────────────────
CANDIDATES = [
    # (路径, 说明, 风险)
    ("C:/Users/tzh/.gradle/caches", "Gradle 依赖缓存（下次构建会重新下载 ~3.6G）", "中"),
    ("C:/Users/tzh/.android/avd/hs-tablet.avd", "死 AVD（启动即静默退出）", "低"),
    ("C:/Users/tzh/.android/avd/hs-tablet2.avd", "死 AVD（启动即静默退出）", "低"),
    ("D:/hfshifter-target-upstream", "Rust 中间产物（下次全量重编，约 7G）", "中"),
]

print("\n【可考虑清理的目标】（按收益排序）\n")
for p, why, risk in CANDIDATES:
    pp = Path(p)
    if not pp.exists():
        print(f"  ✗ 不存在  {p}")
        continue
    # 算体积（浅层，避免太慢）
    try:
        total = 0
        for dirpath, _dirnames, filenames in os.walk(p):
            for fn in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, fn))
                except OSError:
                    pass
        size = f"{total / 1024**3:.2f} G"
    except Exception:
        size = "?"
    print(f"  ▸ {p}")
    print(f"      体积 {size} · 风险 {risk} · {why}")

print("""
================================================================================
【建议的执行方式】（在**你自己的终端**里跑，别让 AI 代劳）

⚠️ 注意：`rm -rf` 会进回收站、**不释放空间**；要真释放必须 `truncate -s 0`
    或"清空回收站"（后者是异步的，可能几分钟后才见效）。

方案 A（最稳，推荐）：清空回收站 + 删 gradle 缓存
    # 1) 清空回收站（PowerShell）
    Clear-RecycleBin -Force
    # 2) 截断 gradle 缓存里的文件（真释放，不进桶）
    find /c/Users/tzh/.gradle/caches -type f -exec truncate -s 0 {} \\;

方案 B（立竿见影）：直接删 Rust 中间产物（D 盘还有 76G，但 C 盘的 CARGO_TARGET_DIR
    若被 junction 过去的就也算 C）
    # 这个是"目录"，要么整体删（进回收站，不释放）要么逐文件截断：
    find /d/hfshifter-target-upstream -type f -exec truncate -s 0 {} \\;

方案 C：删死 AVD（hs-tablet / hs-tablet2 —— memory 记载"启动即静默退出"）
    # 这两个是真正没用的，可直接删目录（约 4G+）

================================================================================
【为什么构建会写到 C 盘】
    `CARGO_TARGET_DIR=D:/hfshifter-target-upstream`（在 D）
    但 gradle 的 `app/build` 与 `jniLibs` 通过 **junction 指向 `D:/hs-build/`**
    ⇒ 理论都在 D。**真正吃 C 盘的是 gradle 自身的临时/缓存**
    （`~/.gradle`、`%TEMP%`→已改到 `D:\\hs-tmp`，以及 `~/.android`）。
""")
