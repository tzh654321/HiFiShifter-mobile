#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修正 v3 的两处偏差：模板字符串被降级 + 两处残留 console.error。"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")
n = 0

# ① 含 ${} 的都应是模板字符串
fixes = [
    ("vibLog('adjustReady effect run hasCb=${String(Boolean(onVibratoAdjustReady))}');",
     "vibLog(`adjustReady effect run hasCb=${String(Boolean(onVibratoAdjustReady))}`);"),
    ("vibLog('slider amp=${amplitude} freq=${frequency} commit=${String(commit)} hasLast=${String(Boolean(lastVibratoRef.current))}');",
     "vibLog(`slider amp=${amplitude} freq=${frequency} commit=${String(commit)} hasLast=${String(Boolean(lastVibratoRef.current))}`);"),
    ("vibLog('committed start=${vib.startFrame} end=${vib.currentFrame} amp=${vib.amplitude} freq=${vib.frequency} hasCb=${String(Boolean(onVibratoCommitted))}');",
     "vibLog(`committed start=${vib.startFrame} end=${vib.currentFrame} amp=${vib.amplitude} freq=${vib.frequency} hasCb=${String(Boolean(onVibratoCommitted))}`);"),
    ("vibLog('pointerup tool=${String(toolMode)} isVibrato=${String(isVibratoTool)} hasVib=${String(Boolean(vib))} mode=${String(st.mode)}');",
     "vibLog(`pointerup tool=${String(toolMode)} isVibrato=${String(isVibratoTool)} hasVib=${String(Boolean(vib))} mode=${String(st.mode)}`);"),
]
for a, b in fixes:
    if a in t:
        t = t.replace(a, b, 1)
        n += 1

# ② 残留的两处 console.error
a2 = "console.error('[HS-VIB] flush frames=' + densePoints.length + ' minF=' + built.minF + ' amp=' + p.amplitude + ' freq=' + p.frequency);"
b2 = "vibLog(`flush frames=${densePoints.length} minF=${built.minF} amp=${p.amplitude} freq=${p.frequency}`);"
if a2 in t:
    t = t.replace(a2, b2, 1)
    n += 1

a3 = "console.error('[HS-VIB] X commit failed: ' + String(err));"
b3 = "vibLog(`X commit failed: ${String(err)}`);"
if a3 in t:
    t = t.replace(a3, b3, 1)
    n += 1

P.write_text(t, encoding="utf-8")
print(f"✓ 修正 {n} 处")
left = t.count("console.error") + t.count("console.warn")
print(f"  文件里剩余 console.error/warn：{left}（应无 HS-VIB 相关）")
