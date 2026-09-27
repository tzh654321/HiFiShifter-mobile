#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#12 收尾：MenuBar 补 import + i18n 键（5 语种同步）。"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
I18N = FE / "i18n"

# ── ① MenuBar 的 import 里补 toggleShortcutHints ──────────────────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

if "toggleShortcutHints" not in t.split("function shortcutLabel")[0].split("from \"../../features/session/sessionSlice\"")[0]:
    # 在从 sessionSlice 的 import 列表里，紧跟 togglePlayheadZoom 之后加一行
    m = re.search(r"(import \{[^}]*?)(\n\s*togglePlayheadZoom,)", t, re.S)
    if m:
        t = t[:m.end(2)] + "\n    toggleShortcutHints," + t[m.end(2):]
        mb.write_text(t, encoding="utf-8")
        print("✓ MenuBar.tsx：import 补 toggleShortcutHints")
    else:
        print("  ⚠ 没在 sessionSlice 的 import 里找到 togglePlayheadZoom，请手工补 import")
else:
    print("  · MenuBar.tsx 已有 toggleShortcutHints")

# ── ② i18n 键（5 语种同步；键类型由 en-US 决定，缺一个语种 tsc 就报错）─────────
KEYS = {
    "zh-CN": ("options_show_shortcut_hints", "显示快捷键提示"),
    "zh-TW": ("options_show_shortcut_hints", "顯示快速鍵提示"),
    "en-US": ("options_show_shortcut_hints", "Show shortcut hints"),
    "ja-JP": ("options_show_shortcut_hints", "ショートカットのヒントを表示"),
    "ko-KR": ("options_show_shortcut_hints", "단축키 힌트 표시"),
}

for loc, (key, val) in KEYS.items():
    f = I18N / f"{loc}.ts"
    text = f.read_text(encoding="utf-8")
    if f"{key}:" in text:
        print(f"  · {loc}.ts 已有 {key}")
        continue
    anchor = "\n} as const;"
    assert anchor in text, f"{loc}.ts 找不到 `}} as const;`"
    text = text.replace(anchor, f'\n    {key}: "{val}",\n{anchor}', 1)
    f.write_text(text, encoding="utf-8")
    print(f"  ✓ {loc}.ts  + {key} = {val}")
