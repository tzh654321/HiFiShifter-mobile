#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#49 收尾：`setTrackStateRemote` 在 `trackThunks.ts`，不在 `timelineThunks`。"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
MT = ROOT / "upstream-src" / "frontend" / "src" / "components" / "mobile" / "MobileTopBar.tsx"
t = MT.read_text(encoding="utf-8")

# ① 从 timelineThunks 的 import 块里摘掉它
pat = re.compile(r'import \{\n(    addTrackRemote,\n    removeTrackRemote,\n)(    /\* #49[^\n]*\n)?(    setTrackStateRemote,\n)\} from "\.\./\.\./features/session/thunks/timelineThunks";')
m = pat.search(t)
assert m, "timelineThunks import 块没匹配到"
t = t[: m.start()] + (
    'import { addTrackRemote, removeTrackRemote } from "../../features/session/thunks/timelineThunks";'
) + t[m.end():]
print("✓ ① 从 timelineThunks 的 import 摘掉 setTrackStateRemote")

# ② 从 trackThunks 正确导入
anchor = 'import { addTrackRemote, removeTrackRemote } from "../../features/session/thunks/timelineThunks";'
addition = (anchor +
            '\n/* #49：算法变更沿用 TimelinePanel 用的同一个 thunk（在 trackThunks 里）。 */\n'
            'import { setTrackStateRemote } from "../../features/session/thunks/trackThunks";')
assert t.count(anchor) == 1
t = t.replace(anchor, addition, 1)
print("✓ ② 改从 trackThunks 导入")

MT.write_text(t, encoding="utf-8")
