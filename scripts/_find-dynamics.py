#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在桌面版主程序里定位「动态」到底是什么功能。

背景：用户反复提到「同步过一次仓库但动态功能没看到」。上游 beta.14 的发布说明里
没有一项叫「动态」，所以它大概是**桌面版某个功能的界面名/菜单项**。
拿安装版 exe 里的字符串做上下文比对是最快的路子。
"""
import re
from pathlib import Path

EXE = Path(r"D:/Program Files/HiFiShifter/HiFiShifter.exe")
if not EXE.is_file():
    raise SystemExit(f"找不到 {EXE}（桌面版安装目录变了？）")

data = EXE.read_bytes()
print(f"exe 大小: {len(data)/1048576:.1f} MB")

needle = "动态".encode("utf-8")
hits = [m.start() for m in re.finditer(re.escape(needle), data)]
print(f"「动态」出现 {len(hits)} 次\n")

# 提取每处上下文（往前 80 / 往后 80 字节），把可打印的片段挑出来
def ctx(off: int, back: int = 80, fwd: int = 80) -> str:
    lo, hi = max(0, off - back), min(len(data), off + fwd)
    seg = data[lo:hi]
    # 只保留可打印（含中文）的连续片段，避免二进制噪点
    s = seg.decode("utf-8", errors="replace")
    s = "".join(ch if (ch.isprintable() or ch == "\n") else "·" for ch in s)
    return re.sub(r"·{2,}", "···", s)

for i, off in enumerate(hits[:12], 1):
    print(f"── 第 {i} 处 @0x{off:x} ──")
    print(ctx(off))
    print()


# 顺便看看桌面版有哪些和「动态」可能相关的词，帮助判断是不是同一个功能
print("=== 其他候选关键词是否出现 ===")
for w in ["动态", "Dynamics", "dynamics", "动态处理", "动态范围", "侧链", "压缩器"]:
    n = len(re.findall(re.escape(w.encode("utf-8")), data))
    print(f"  {w}: {n}")
