#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B2：∨ 菜单里的「↘MID」换成真图标，按钮比例与旁边一致。

## 现象（CDP 实测）

```
<button data-disabled="true" class="rt-reset rt-BaseButton rt-r-size-1 rt-variant-soft rt-Button" disabled>
    导入 MIDI
</button>          ← 宽 43 × 高 36（文字太长被压成两行 ⇒ 用户看到的就是「↘MID」）
参考轨道组          ← 宽 92 × 高 36
```

旁边的工具按钮（同步时间轴、选择、绘制…）用的都是**正方形 `IconButton`**，
只有这一个还是**文字 `Button`** ⇒ 宽度装不下"导入 MIDI"，被挤成两行。

## 改法

`FileBrowserPanel.tsx:206` 里**已经有**一个画好的 `MidiIcon`（双音符 + 连线，14×14）。
与其再画一份（上游注释明确反对"两处各画一份而漂移"），不如**把它 export 出来复用**。

然后：
- `<Button size="1" variant="soft">{tAny("midi_import")}</Button>`
- ⇒ `<IconButton size="1" variant="soft" aria-label={…} data-tooltip={…}><MidiIcon /></IconButton>`

⚠️ 保留 `data-tooltip`（原来的 tooltip 是"导入 MIDI"，图标化后更需要它）
以及 `disabled={!pitchEnabled}`（音高未开启时禁用）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① FileBrowserPanel：把 MidiIcon 变成可复用 ─────────────────────────────
FB = FE / "components" / "layout" / "FileBrowserPanel.tsx"
t = FB.read_text(encoding="utf-8")
old = "function MidiIcon({ className }: { className?: string }) {"
assert t.count(old) == 1, "MidiIcon 锚不唯一"
t = t.replace(old,
    "/**\n"
    " * MIDI 文件图标（双音符 + 连线）。\n"
    " *\n"
    " * ⚠️ 已 `export`：参数编辑器 ∨ 菜单的「导入 MIDI」按钮也复用它\n"
    " * （原来是文字按钮，宽 43px 装不下「导入 MIDI」被挤成两行 ⇒ 用户看到「↘MID」）。\n"
    " * 遵循上游一贯原则：同一个图形只画一份，避免两处漂移。\n"
    " */\n"
    "export function MidiIcon({ className }: { className?: string }) {", 1)
FB.write_text(t, encoding="utf-8")
print("✓ FileBrowserPanel：MidiIcon 已 export")

# ── ② PianoRollPanel：文字按钮 → IconButton + 图标 ──────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

old_btn = """                                    <Button
                                        size="1"
                                        /* 跟随全局强调色（原独立 blue 与播放键的 iris 是两种蓝） */
                                        variant="soft"
                                        onClick={handleOpenMidiDialog}
                                        disabled={!pitchEnabled}
                                        style={{ cursor: "pointer" }}
                                    >
                                        {tAny("midi_import")}
                                    </Button>"""
new_btn = """                                    {/* B2（用户口径）：原来是文字 Button，宽 43px 装不下
                                        「导入 MIDI」被压成两行（看起来像「↘MID」），
                                        且与旁边一排正方形 IconButton 比例不一致。
                                        ⇒ 改为 IconButton + 复用 FileBrowserPanel 的 MidiIcon。 */}
                                    <IconButton
                                        size="1"
                                        variant="soft"
                                        aria-label={tAny("midi_import")}
                                        data-tooltip={tAny("midi_import")}
                                        onClick={handleOpenMidiDialog}
                                        disabled={!pitchEnabled}
                                        style={{ cursor: "pointer" }}
                                    >
                                        <MidiIcon />
                                    </IconButton>"""
assert t.count(old_btn) == 1, "按钮锚不唯一"
t = t.replace(old_btn, new_btn, 1)
print("✓ PianoRollPanel：导入 MIDI 改为 IconButton + MidiIcon")

# import MidiIcon
if "MidiIcon" in t and 'from "./FileBrowserPanel"' not in t:
    anchor = 'import { createPortal } from "react-dom";'
    if anchor in t:
        # 已删过 createPortal，改挂到 IconButton 的 import 之后
        pass
    m = None
    import re
    m = re.search(r'^import \{ IconButton \} from "([^"]+)";', t, re.M)
    if not m:
        m = re.search(r'^import .*IconButton.*$', t, re.M)
    assert m, "找不到 IconButton 的 import"
    line_end = t.find("\n", m.start())
    t = t[:line_end + 1] + 'import { MidiIcon } from "./FileBrowserPanel";\n' + t[line_end + 1:]
    print("✓ 加了 MidiIcon 的 import")
else:
    print("  · import 检查")

# IconButton 是否已 import
if "IconButton" not in t.split("export")[0]:
    print("  ⚠️ 注意：IconButton 可能没 import，tsc 会报")

PP.write_text(t, encoding="utf-8")
print("✓ 完成")
