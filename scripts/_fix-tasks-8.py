#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 TASKS.md 里 #8 那行被 bash 反引号吞掉的内容。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
lines = P.read_text(encoding="utf-8").splitlines(keepends=True)

NEW = (
    "| 8 | 默认存储目录 → /storage/emulated/0/HiFiShifter | ✅ **已实现（走 SAF）**，验证到闭环前半。用户拍板用 SAF。\n"
    "  关键设计：**tree URI ↔ 真实路径可互推**（`primary%3AHiFiShifter` ⇒ `/storage/emulated/0/HiFiShifter`），\n"
    "  所以**前端继续用真实路径**当 currentPath，Rust 在 `list_directory` 里判断「是否落在已授权 tree 内」⇒ 是则走 SAF、否则照旧。\n"
    "  三层：Kotlin（`KIND_TREE` 授权 + `listTreeChildren`，用系统 `DocumentsContract` 不引依赖）/ "
    "Rust（`tree_real_prefix` + `list_directory_via_saf` + `pick_folder` 实现）/ "
    "前端（`DEFAULT_ANDROID_MUSIC_DIR` + 错误态「授权访问目录」按钮）。\n"
    "  ✅ 实测：默认路径已显示 / 未授权时正确报错并出现授权按钮。"
    "⏳ **授权后能否列目录待点按钮验证**（SAF 系统 UI 无法用 CDP 驱动）| A | WIP |\n"
)

out = []
replaced = False
for i, l in enumerate(lines):
    if l.startswith("| 8 |") and not replaced:
        out.append(NEW)
        replaced = True
        # 跳过原来那行的续行（以两个空格开头的行）
        j = i + 1
        while j < len(lines) and lines[j].startswith("  "):
            j += 1
        # 把跳过的标记出来：用 continue 机制处理
        out.append(f"__SKIP_UNTIL__{j}")
        continue
    if out and isinstance(out[-1], str) and out[-1].startswith("__SKIP_UNTIL__"):
        target = int(out[-1].split("__SKIP_UNTIL__")[1])
        if i < target:
            continue
        out.pop()
    out.append(l)

P.write_text("".join(out), encoding="utf-8")
print("✓ TASKS.md #8 行已重写" + ("（找到并替换）" if replaced else "（⚠️ 未找到 #8 行）"))

# 体检
txt = P.read_text(encoding="utf-8")
line8 = next((l for l in txt.splitlines() if l.startswith("| 8 |")), None)
print(f"  反引号 {line8.count(chr(96))} 个（应为偶数）" if line8 else "  ✗ 丢失")
