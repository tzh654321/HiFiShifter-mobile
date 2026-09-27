#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第一条的第二半：**时间线**拍数栏双击也起播。

时间线的拍数栏是原生 DOM，事件用命令式绑定（`bindRulerTouchSeek(rulerEl)`），
所以双击要在同一处挂 —— 与参数编辑器那条语义一致：
**单击 seek（已有），双击 seek 后再起播（且仅在未播放时）**。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = "                offs.push(bindRulerTouchSeek(rulerEl));"
assert t.count(old) == 1, "bindRulerTouchSeek 调用锚不唯一"
t = t.replace(old, old + """

                /* E 组：拍数栏**双击 = 移动进度条并开始播放**（与参数编辑器同一口径）。
                   单击的 seek 由 `bindRulerTouchSeek` 负责，这里只补起播 ——
                   且**仅在未播放时**，免得双击把正在播放的曲子停掉。 */
                const onRulerDblClick = () => {
                    const st = store.getState().session;
                    if (!st.isPlaying) void dispatch(playOriginal());
                };
                rulerEl.addEventListener("dblclick", onRulerDblClick);
                offs.push(() => rulerEl.removeEventListener("dblclick", onRulerDblClick));""", 1)
print("✓ TimelinePanel：拍数栏加 dblclick 起播")

import re
m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if not m:
    m = re.search(r'^import \{([^}]*)\} from "\.\./\.\./features/session/sessionSlice";', t, re.M)
if m and "playOriginal" not in m.group(1):
    t = t[:m.start()] + f'import {{{m.group(1).rstrip()}\n    playOriginal,\n}} from "../../features/session/sessionSlice";' + t[m.end():]
    print("  ✓ import 补 playOriginal")
else:
    print("  · playOriginal 检查:", "已有" if m and "playOriginal" in m.group(1) else "⚠️")

TP.write_text(t, encoding="utf-8")
print("✓ 完成")
