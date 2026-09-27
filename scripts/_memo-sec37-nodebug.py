#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录构建工具链的 node bug（本轮卡住的原因）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊲ 🕳️ 构建中断在 `node.exe.bat`：改前端会触发 Rust 重编，就会撞上这个坑

### 现象

改了**前端**之后连续 4 次构建失败，全都是同一个 task：

```
Execution failed for task ':app:rustBuildX86_64Debug'.
> A problem occurred starting process 'command '…\\node\\versions\\22.22.2\\node.exe.bat'''
```

`node.exe.bat` **根本不存在** —— 是 tauri 的 Android gradle 插件在 Windows 上
把 `node` 拼成了 `node.exe.bat`。

### 为什么"之前一直好好的"

**`rustBuildX86_64Debug` 这个 task 只要命中 UP-TO-DATE 就根本不会执行** ——
所以这个 bug **一直存在但一直没暴露**。

而**改前端 ⇒ 会触发 Rust 重编**（tauri 要把 `frontend/dist` 嵌进 `libbackend_lib.so`）
⇒ 这个 task 必须真跑 ⇒ bug 暴露。

⚠️ 这解释了为什么"以前改了前端也能构建成功"是错觉：
那几次**恰好** Rust 侧没变、task 命中缓存。**一旦前端 + Rust 都动，就会卡。**

### 根因

MSYS 的 `which node` 返回的是 **`…/node`（不带 `.exe`）**：

```
which node ⇒ /c/Users/tzh/.workbuddy/binaries/node/versions/22.22.2/node
```

tauri 的 gradle 插件拿到这个字符串，按 Windows 惯例补 `.exe`、再补 `.bat` ⇒ `node.exe.bat`。

### 试过但**没用**的修法

| 尝试 | 结果 |
| :--- | :--- |
| 在 `.bin` 里放 `node.exe.bat` | 无效（gradle 用的是 **node 自己目录**下的路径）|
| 在 node 目录放简单转发版 `node.exe.bat` | 从"启动失败"变成"退出码 1"，**依然不通** |
| 想让垫片记录参数来诊断 | 诊断文件始终为空 ⇒ **Java 那边根本没真正启动这个 `.bat`** |

⇒ **别在这条路上继续耗**。垫片方案不通。

### ✅ 有效解法：构建时把 workbuddy 的 node 从 PATH 里摘掉

```bash
CLEAN=$(echo "$PATH" | tr ':' '\\n' | grep -v "workbuddy/binaries/node" | paste -sd: -)
export PATH="$CLEAN"     # 于是 which node ⇒ /c/Program Files/nodejs/node
bash scripts/build-apk.sh x86_64
```

⚠️ **必须写成脚本文件再 `nohup bash <脚本>`**。
我一开始写成 `nohup env PATH="$CLEAN" bash scripts/build-apk.sh &` ——
**日志是空的、脚本压根没启动**，白等了 15 分钟还以为是"构建太慢"。
**判据：`wc -l 日志` 应该在几秒内就 > 0；为空就说明命令根本没跑起来。**

### 还没解决的疑点

摘掉 workbuddy 的 node 之后用的是**系统 node v24.19.0**（workbuddy 那份是 22.22.2）。
**两边大版本不同**，需要确认构建产物没问题（vite / tauri-cli 都跑通了吗）。
如果后续出问题，正解应该是**给 workbuddy 那份 node 的目录里放一个真正的 `node.exe` 副本**，
或改 `build-apk.sh` 在构建期间把 PATH 指向一个"只有 node.exe、没有 node 无扩展名文件"的目录。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊲ 节已追加")
