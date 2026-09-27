#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修 #49 引入的 3 个 tsc 错误。

1. `s.tracks` 不在 selector 里 ⇒ 补上（顺带确认字段名就是 `tracks`）；
2. `tr` 隐式 any ⇒ 由 ① 自动解决（有类型了）；
3. `setTrackStateRemote` 没 import —— 上个脚本用
   `if "setTrackStateRemote" not in t` 判断，而**它已经出现在新代码里**，
   于是误判为"已导入" ⇒ 这个判据本身写错了，改用 import 块判断。
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
MT = ROOT / "upstream-src" / "frontend" / "src" / "components" / "mobile" / "MobileTopBar.tsx"
t = MT.read_text(encoding="utf-8")

# ── ① 补 tracks 到 selector ─────────────────────────────────────────────
old = """            paramSelectionActive: st.session.paramSelectionActive,"""
new = """            paramSelectionActive: st.session.paramSelectionActive,
            /* #49：轨道菜单要判「选中轨是否根轨 + 是否开了 Compose」，需要轨道列表。 */
            tracks: st.session.tracks,"""
assert t.count(old) == 1, f"① 锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
print("✓ ① selector 补 tracks")

# ── ② 补 import（判据改成看 import 块，别被正文里的名字骗到）──────────
imp_pat = re.compile(r'import \{([^}]*?)\} from "\.\./\.\./features/session/thunks/timelineThunks";', re.S)
m = imp_pat.search(t)
assert m, "找不到 timelineThunks 的 import 块"
names = m.group(1)
if "setTrackStateRemote" not in names:
    t = t[: m.start()] + (
        'import {\n'
        '    addTrackRemote,\n'
        '    removeTrackRemote,\n'
        '    /* #49：算法变更沿用 TimelinePanel 的同一个 action，直接调、不穿 props。 */\n'
        '    setTrackStateRemote,\n'
        '} from "../../features/session/thunks/timelineThunks";'
    ) + t[m.end():]
    print("✓ ② 补 setTrackStateRemote import")
else:
    print("· ② import 里已有 setTrackStateRemote")

MT.write_text(t, encoding="utf-8")
