#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 + #16：每个分屏面板槽位叠一个 X 关闭键（用普通字符串避免 f-string 花括号冲突）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 撤掉加在 .hs-param-head 里的 X ──────────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
p = PP.read_text(encoding="utf-8")
OLD_X = """                    {/* #15：参数界面的**关闭键**（左上角 X）。
                        只在手机显示（`hs-param-close` 由 CSS 按宽度控制）——
                        平板上参数行是常显的，没有"关闭"一说。
                        出口与顶栏「视图 → 参数面板」一致 ⇒ `toggleMobilePanel("params")`。 */}
                    <IconButton
                        size="1"
                        variant="ghost"
                        className="hs-param-close"
                        data-tooltip={tAny("close")}
                        aria-label={tAny("close")}
                        tabIndex={-1}
                        onClick={() => dispatch(toggleMobilePanel("params"))}
                    >
                        <Cross2Icon />
                    </IconButton>
"""
if OLD_X in p:
    p = p.replace(OLD_X, "", 1)
    PP.write_text(p, encoding="utf-8")
    print("✓ 撤掉 .hs-param-head 里的 X")
else:
    print("  · 旧 X 不在（可能已撤）")

# ── ② 每个面板槽位叠一个 X ────────────────────────────────────────────────
APP = FE / "App.tsx"
a = APP.read_text(encoding="utf-8")

X_BLOCK = (
    '                                {/* #16：**各面板自己的关闭键** —— 分屏时每块都能独立收起。 */}\n'
    '                                <IconButton\n'
    '                                    size="1"\n'
    '                                    variant="solid"\n'
    '                                    color="gray"\n'
    '                                    className="!absolute right-1 top-1 z-50 opacity-90"\n'
    '                                    aria-label={tAny("close")}\n'
    '                                    data-tooltip={tAny("close")}\n'
    '                                    onClick={() => dispatch(toggleMobilePanel("PANEL"))}\n'
    '                                >\n'
    '                                    <Cross2Icon />\n'
    '                                </IconButton>\n'
)

PANELS = [
    ("timeline", "TimelinePanel", "时间线"),
    ("params", "PianoRollPanel", "参数"),
    ("files", "FileBrowserPanel", "文件"),
    ("notes", "NotebookPanel", "记事本"),
]

n = 0
for key, comp, label in PANELS:
    old = (
        '                        {mobilePanels.' + key + ' ? (\n'
        '                            <div className="flex-1 min-h-0 relative">\n'
        '                                <' + comp
    )
    if a.count(old) != 1:
        print(f"  ⚠️ {label}：锚命中 {a.count(old)} 次，跳过")
        continue
    new = (
        '                        {mobilePanels.' + key + ' ? (\n'
        '                            <div className="flex-1 min-h-0 relative">\n'
        + X_BLOCK.replace("PANEL", key) +
        '                                <' + comp
    )
    a = a.replace(old, new, 1)
    n += 1
    print(f"  ✓ {label}：加 X")

APP.write_text(a, encoding="utf-8")
print(f"共 {n} 个面板")

# ── ③ import Cross2Icon ───────────────────────────────────────────────────
import re
head = a.split("export default")[0][:30000]
if "Cross2Icon" not in head:
    m = re.search(r'import \{([^}]*)\} from "@radix-ui/react-icons";', a)
    if m:
        a = (a[:m.start()]
             + 'import {' + m.group(1).rstrip() + '\n    Cross2Icon,\n} from "@radix-ui/react-icons";'
             + a[m.end():])
        print("✓ import 加 Cross2Icon")
    else:
        a = 'import { Cross2Icon } from "@radix-ui/react-icons";\n' + a
        print("✓ 新增 radix-icons import")
    APP.write_text(a, encoding="utf-8")
else:
    print("  · Cross2Icon 已有")

# ── ④ 确认 tAny 可用 ──────────────────────────────────────────────────────
print("  · tAny:", "有" if "tAny" in a[:30000] else "⚠️ 需确认")
print("  · toggleMobilePanel:", "有" if "toggleMobilePanel" in a[:30000] else "⚠️ 需确认")
print("  · IconButton:", "有" if "IconButton" in a[:30000] else "⚠️ 需确认")
