#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补 TimelinePanel 的 setTouchModifiers / clearTouchModifiers 值导入。"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "TimelinePanel.tsx")
t = P.read_text(encoding="utf-8")

old = 'import type { TimelineKernelHost } from "./timeline/kernel/host/timelineKernelHost";'
assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = (old + '\n'
       '/* E 组（触屏修饰键）：双指长按会点亮"虚拟 Alt"，使拖块走 slip。 */\n'
       'import {\n'
       '    setTouchModifiers,\n'
       '    clearTouchModifiers,\n'
       '} from "./timeline/kernel/host/timelineKernelHost";')

t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ 补值导入")
