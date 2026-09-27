#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#12 收尾（第二轮）：把 showShortcutHints 接进 UiSettings 类型、MenuBar 的 selector 与 import。

第一轮漏了两处类型/接线（tsc 报 `UiSettings` 没有该字段、MenuBar 找不到 `toggleShortcutHints`）：
  · 前端的 `UiSettings`（services/api/settings.ts）是**另一套**类型，与 Rust 的 config 分开维护；
  · MenuBar 里的 `s` 不是整个 session，而是一个**手工挑字段**的对象字面量 ——
    所以「加到 sessionSlice」并不等于「MenuBar 能读到」，必须显式加进那个字面量。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① UiSettings 类型 ────────────────────────────────────────────────────────
st = FE / "services" / "api" / "settings.ts"
t = st.read_text(encoding="utf-8")
m = re.search(r"(export interface UiSettings \{[^}]*?)(\n\})", t, re.S)
assert m, "找不到 UiSettings 接口体"
if "showShortcutHints" not in m.group(1):
    add = "\n    /** 是否显示菜单里的快捷键提示（默认关，用户口径） */\n    showShortcutHints?: boolean;"
    t = t[:m.end(1)] + add + t[m.end(1):]
    st.write_text(t, encoding="utf-8")
    print("✓ settings.ts：UiSettings 加 showShortcutHints?: boolean")
else:
    print("  · UiSettings 已有该字段")

# ── ② MenuBar：selector 字面量 + import ──────────────────────────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

a = "        showClipboardPreview: session.showClipboardPreview,"
assert t.count(a) == 1, "selector 锚不唯一"
t = t.replace(a, a + "\n        showShortcutHints: session.showShortcutHints,", 1)
print("✓ MenuBar.tsx：selector 加 showShortcutHints")

# import：在 sessionSlice 的 import 列表里补 toggleShortcutHints
if not re.search(r"import \{[^}]*\btoggleShortcutHints\b", t, re.S):
    m2 = re.search(r"(import \{)([^}]*?)\n(\} from \"\.\./\.\./features/session/sessionSlice\";)", t, re.S)
    if m2:
        body = m2.group(2)
        # 插到 togglePlayheadZoom 后面；没有就插到列表末尾
        if "togglePlayheadZoom," in body:
            body = body.replace("togglePlayheadZoom,", "togglePlayheadZoom,\n    toggleShortcutHints,", 1)
        else:
            body = body.rstrip() + "\n    toggleShortcutHints,"
        t = t[:m2.start(2)] + body + t[m2.end(2):]
        mb.write_text(t, encoding="utf-8")
        print("✓ MenuBar.tsx：import 补 toggleShortcutHints")
    else:
        print("  ⚠ 没找到 sessionSlice 的 import 块，请手工补")
else:
    print("  · MenuBar.tsx 已 import toggleShortcutHints")
