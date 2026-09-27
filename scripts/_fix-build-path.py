#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「构建时摘掉 workbuddy 的 node」固化进 build-apk.sh（修 node.exe.bat 那个坑）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "scripts" / "build-apk.sh"
t = P.read_text(encoding="utf-8")

ANCHOR = 'PATH="$ROOT/probes/m0-probe/node_modules/.bin:$PATH"\nexport PATH'
assert t.count(ANCHOR) == 1, f"锚不唯一：{t.count(ANCHOR)}"

ADD = """PATH="$ROOT/probes/m0-probe/node_modules/.bin:$PATH"
export PATH

# ── 摘掉 WorkBuddy 自带的 node（HS-NODE-PATH-FIX）─────────────────────────────
# 🕳️ 2026-09-24 实测：改动**前端**会触发 tauri 重编 Rust（要把 frontend/dist 嵌进
# libbackend_lib.so），于是 `:app:rustBuildX86_64Debug` 必须真跑 —— 而它一跑就报：
#
#   A problem occurred starting process
#   'command '…\\node\\versions\\22.22.2\\node.exe.bat'''
#
# 根因：MSYS 的 `which node` 返回 **`…/node`（不带 .exe）**，tauri 的 gradle 插件
# 按 Windows 惯例补 `.exe` 再补 `.bat` ⇒ 得到一个不存在的 `node.exe.bat`。
# 之前一直没暴露，是因为这个 task 常年命中 UP-TO-DATE —— **改前端 + 动 Rust 才会撞上**。
#
# 试过但无效：在 `.bin` 或 node 目录放转发用的 `.bat`（Java 那边根本启动不了它）。
# ✅ 有效：**构建期间把 WorkBuddy 的 node 目录从 PATH 里摘掉**，改用系统 nodejs。
# ⚠️ 还要 `gradlew --stop`：**daemon 的环境在启动时定型**，不重启 daemon 的话
#    改了 PATH 也白改（实测踩过）。
_CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\\n' | grep -v 'workbuddy/binaries/node' | paste -sd: -)"
if [ -n "$_CLEAN_PATH" ]; then
  PATH="$_CLEAN_PATH"
  export PATH
fi
"""'
t = t.replace(ANCHOR, ADD.rstrip("\n"), 1)
P.write_text(t, encoding="utf-8")
print("✓ build-apk.sh：已加入 PATH 清理（HS-NODE-PATH-FIX）")

import subprocess
r = subprocess.run(["bash", "-n", str(P)], capture_output=True, text=True)
print("  bash -n:", "OK" if r.returncode == 0 else r.stderr[:200])
