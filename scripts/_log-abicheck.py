#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 ABI 自检接进构建脚本 + 三个 `set -e` 雷修复。"""
from pathlib import Path

M = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\.workbuddy\memory\2026-09-22.md")
M.write_text(M.read_text(encoding="utf-8") + """

## ✅ ABI 自检接进 build-apk.sh + 修掉三个 `set -e` 雷（07:28-07:40）

### 接进构建脚本（`build-apk.sh` 新增第 ⑩ 步）

构建完、归档后自动：
1. 打印**正确的装机命令**（明确写「用归档包，别用中间产物」）；
2. 若有在线设备，**自动跑 `check-apk-abi.sh` 比对 ABI**；不通过就打警告「**先别装**」。

### 🔴 修掉三个同类的 bash 雷

`check-apk-abi.sh` 初版里写了三处：

```bash
[ -z "$X" ] && { red "..."; exit 2; }
```

**两个独立问题**：

1. **`set -e` 下命令替换失败会直接退出** —— `ABI="$(adb ... | tr ...)"` 里 adb 非零退出
   ⇒ 脚本**在赋值那一行就静默死掉**（exit 1、**零输出**），下面的错误提示永远打不出来。
   ⇒ 修：`$(... || true)`。
2. 🔴 **`[ -z "$X" ] && { ... }` 在条件为「假」时整条返回 1** ⇒ `set -e` **直接退出**。
   也就是说**匹配成功那种情况反而会死**（`-z` 为假 ⇒ `&&` 短路 ⇒ 返回 1）。
   ⇒ 修：一律改写成 `if [ -z "$X" ]; then ...; fi`。
   ★ **这正是 MEMORY.md 里早就记着的那条**：
     「`[ -e "$f" ] && cmd` 在 `set -e` 下是雷 ⇒ 一律 `if`」。
     **我会写脚本却忘了它，说明那条记忆必须更显眼。**

### 三分支实测（全部通过）

| 场景 | exit | 判 |
| :--- | :--: | :--- |
| x86_64 包 ↔ x86_64 模拟器 | **0** | ✅ `匹配：…可以装` |
| arm64 包 ↔ x86_64 模拟器 | **1** | ❌ `不匹配` + 转译风险说明 + 给出该用的命令 |
| 设备不可达 | **2** | ❌ `设备不可达（或未授权）` |

⚠️ 验证时**必须把 stdout 重定向到文件再看 `$?`** ——
`bash script.sh 2>&1 | tail -5; echo $?` 里的 `$?` 是 **`tail` 的**，不是脚本的。
（这一条也踩了，第一轮误以为"退出码是 0"。）
""", encoding="utf-8")
print("✓ memory 已追加")

T = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\TASKS.md")
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ ABI 自检接进构建链（2026-09-27 07:40）

`build-apk.sh` 新增第 **⑩** 步：归档后自动
① 打印**正确的装机命令**（写明「用归档包，别用中间产物」）；
② 若有在线设备 ⇒ **自动跑 `check-apk-abi.sh` 比对 ABI**，不通过就警告「**先别装**」。

**`check-apk-abi.sh` 三分支实测全通过**：

| 场景 | exit | 结果 |
| :--- | :--: | :--- |
| x86_64 包 ↔ x86_64 模拟器 | **0** | ✅ 可以装 |
| arm64 包 ↔ x86_64 模拟器 | **1** | ❌ 不匹配 + 转译风险说明 + 正确命令 |
| 设备不可达 | **2** | ❌ 设备不可达（或未授权）|

🔴 **顺带修了三个同类的 bash 雷**（`[ -z "$X" ] && { ...; }`）：
`set -e` 下条件为假时整条返回 1 ⇒ **匹配成功反而会退出**。
已全部改成 `if ... fi` —— 这正是 MEMORY.md 里早有的一条（「`[ ] && cmd` 在 `set -e` 下是雷」）。

⚠️ **教训（新）**：验证脚本退出码时 `bash s.sh \\| tail -5; echo $?` 里的 `$?` 是 **`tail` 的**。
必须重定向到文件再 `echo $?`。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
