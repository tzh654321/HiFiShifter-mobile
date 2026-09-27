#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v 菜单：把 `↘MID` 换成**真正可辨识的 MIDI 图标**（钢琴键）。

## 问题

`MidiIcon`（`FileBrowserPanel.tsx:213`）画的是**两个带符干的音符**：

```
  ♪ 
 ♪  ↘  ← 斜向 + 两个「M」形音符
```

⇒ **视觉上就是「↘M」** —— 用户看到的「↘MID」正是它的形状，不是文字被压成两行。

## 做法

新增 `MidiKeysIcon`：**钢琴键**造型（黑键嵌在白键上），
`14×14` 与旁边那排（拖动方向 / 锁）**同尺寸同描边风格**（`strokeWidth 1.2`、`currentColor`）。

⚠️ **不改原 `MidiIcon`** —— 文件浏览器里的文件列表还在用它，那个语境下音符是合适的；
只在 **参数行那颗按钮** 上换成钢琴键，因为那里需要一眼区分"导入 MIDI"。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 在 FileBrowserPanel 里加 MidiKeysIcon（与 MidiIcon 并排）──────────────
FB = FE / "components" / "layout" / "FileBrowserPanel.tsx"
t = FB.read_text(encoding="utf-8")

anchor = """            <path d="M5 2.5L12.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}"""

assert t.count(anchor) == 1, f"MidiIcon 尾部锚命中 {t.count(anchor)} 次"

NEW = anchor + """

/**
 * MIDI 图标（**钢琴键**版）。
 *
 * 【为什么另起一个】原 `MidiIcon` 画的是两个带符干的音符，斜向排列下
 * **视觉上就是「↘M」** —— 手机参数行那颗按钮因此被认成「↘MID」（甚至像被压成两行）。
 * 文件列表里用音符是合适的，但**按钮上需要一眼可辨** ⇒ 这里用钢琴键。
 *
 * 尺寸 / 描边与旁边那排（拖动方向、锁）保持一致：14×14、strokeWidth 1.2、currentColor。
 */
export function MidiKeysIcon({ className }: { className?: string }) {
    return (
        <svg width="14" height="14" viewBox="0 0 15 15" fill="none" className={className}>
            {/* 白键外框 */}
            <rect
                x="1.5"
                y="3"
                width="12"
                height="9"
                rx="0.8"
                stroke="currentColor"
                strokeWidth="1.2"
            />
            {/* 三条白键分隔线 */}
            <path d="M4.5 3V12M7.5 3V12M10.5 3V12" stroke="currentColor" strokeWidth="1.2" />
            {/* 两个黑键（填色，与白键线区分） */}
            <rect x="3.6" y="3" width="1.8" height="4.2" fill="currentColor" />
            <rect x="9.6" y="3" width="1.8" height="4.2" fill="currentColor" />
        </svg>
    );
}"""

t = t.replace(anchor, NEW, 1)
FB.write_text(t, encoding="utf-8")
print("✓ MidiKeysIcon 已加")

# ── ② 参数行那颗按钮改用它 ─────────────────────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
p = PP.read_text(encoding="utf-8")

c1 = p.count('import { MidiIcon } from "./FileBrowserPanel";')
if c1 == 1:
    p = p.replace('import { MidiIcon } from "./FileBrowserPanel";',
                  'import { MidiIcon, MidiKeysIcon } from "./FileBrowserPanel";', 1)
    print("✓ import 加 MidiKeysIcon")

c2 = p.count("<MidiIcon />")
if c2 >= 1:
    p = p.replace("<MidiIcon />", "<MidiKeysIcon />")
    print(f"✓ 替换 <MidiIcon /> → <MidiKeysIcon /> × {c2}")

PP.write_text(p, encoding="utf-8")
print("✓ 完成")
