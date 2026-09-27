#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#32 播放时点击拍数栏 = 跳转 + 暂停。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TP = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                    if (mode === "undecided") {
                        // 没超过阈值 = 点击 ⇒ 拖时间线。
                        seekAt(e.clientX, true);
                    }"""

assert t.count(old) == 1, f"锚命中 {t.count(old)} 次"

new = """                    if (mode === "undecided") {
                        // 没超过阈值 = 点击 ⇒ 拖时间线。
                        /* #32：**播放中点击要先暂停** —— 用户点拍数栏的意图是
                           "停在这里"，而不是"跳过去接着播"。
                           ⚠️ 只加在单击路径：双击（= 移动进度条并开始播放）也走
                           `seekAt`，在那儿加会把刚起的播放又停掉。 */
                        if (store.getState().session.runtime.isPlaying) {
                            void dispatch(stopAudioPlayback());
                        }
                        seekAt(e.clientX, true);
                    }"""

t = t.replace(old, new, 1)
print("✓ 单击拍数栏：播放中先暂停再 seek")

import re
head = t.split("export function TimelinePanel")[0]
if "stopAudioPlayback" not in head:
    m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
    if m:
        t = t[:m.start()] + f'import {{{m.group(1).rstrip()}\n    stopAudioPlayback,\n}} from "../../features/session/sessionSlice";' + t[m.end():]
        print("  ✓ import 补 stopAudioPlayback")
    else:
        print("  ⚠️ 找不到 sessionSlice 的 import")
else:
    print("  · stopAudioPlayback 已 import")

TP.write_text(t, encoding="utf-8")
