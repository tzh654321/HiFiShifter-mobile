#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 `node.exe.bat` 垫片，绕开 tauri gradle 插件的 node 解析 bug。

**问题**：`app:rustBuildX86_64Debug` 报
`A problem occurred starting process 'command '…\\node\\versions\\22.22.2\\node.exe.bat''`

**根因**：MSYS 的 `which node` 返回 **`…/node`（不带 `.exe`）**；
tauri 的 Android gradle 插件在 Windows 上拿到这个字符串后**又拼了个 `.bat`** ⇒
`node.exe.bat` 根本不存在。（之前没暴露，是因为这个 task 一直命中 UP-TO-DATE 缓存。）

**修法**：在构建时加进 PATH 的 `.bin` 目录里放一个 `node.exe.bat`，
内容就是转调真正的 `node.exe`。属于**垫片**，不是根治 —— 根治要改 tauri-cli 的
插件代码（`nodeCommand` 的 win32 分支），不值得为此 fork。

⚠️ `node_modules/.bin` 会被 `npm install` 清掉，所以这段也同步写进 `build-apk.sh`，
让它**每次构建都确保存在**。
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "probes" / "m0-probe" / "node_modules" / ".bin"
BIN.mkdir(parents=True, exist_ok=True)

NODE_EXE = Path(r"C:\Users\tzh\.workbuddy\binaries\node\versions\22.22.2\node.exe")
assert NODE_EXE.exists(), f"找不到 node.exe: {NODE_EXE}"

SHIM = BIN / "node.exe.bat"
# .bat 必须用 CRLF（Windows cmd 对 LF 的兼容性不稳）
SHIM.write_bytes(
    b"@echo off\r\n" + f'"{NODE_EXE}" %*\r\n'.encode("ascii")
)
print(f"✓ 已写 {SHIM}")
print(f"  内容: {SHIM.read_bytes()!r}")
