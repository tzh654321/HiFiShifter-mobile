#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""屏上诊断（第二部分）：PianoRollPanel 的 state + hook 的 onVibratoDiag。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① PianoRollPanel：加 diag state ─────────────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

a1 = """    >(
        null,
    );"""
assert t.count(a1) >= 1, "ref 收尾锚不唯一"
# 只替换第一次出现（vibratoAdjustFnRef 的那处）
idx = t.index("const vibratoAdjustFnRef = React.useRef<")
tail = t.index(a1, idx) + len(a1)
t = t[:tail] + """

    /** 临时诊断串：定位「拖滑条曲线不变」。定完即删。 */
    const [vibratoDiag, setVibratoDiag] = React.useState("");""" + t[tail:]
print("✓ PianoRollPanel：加 vibratoDiag state")

a2 = """            onChange={(next) => {
                vibratoAdjustFnRef.current?.(next);"""
assert t.count(a2) == 1, "onChange 锚不唯一"
t = t.replace(a2, """            diag={vibratoDiag}
            onChange={(next) => {
                setVibratoDiag(
                    `ref:${vibratoAdjustFnRef.current ? "Y" : "N"} amp:${Math.round(next.amplitude)} fq:${next.frequency.toFixed(2)}`,
                );
                vibratoAdjustFnRef.current?.(next);""", 1)
print("✓ PianoRollPanel：onChange 更新诊断 + 传给浮层")

# 把 onVibratoDiag 传给 hook
a3 = """        onVibratoAdjustReady: useCallback("""
assert t.count(a3) == 1, "onVibratoAdjustReady 锚不唯一"
t = t.replace(a3, """        onVibratoDiag: setVibratoDiag,
        onVibratoAdjustReady: useCallback(""", 1)
PP.write_text(t, encoding="utf-8")
print("✓ PianoRollPanel：传 onVibratoDiag 给 hook")

# ── ② hook：解构 + flush 各分叉回传 ─────────────────────────────────────────
H = FE / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = H.read_text(encoding="utf-8")

a4 = "        onVibratoAdjustReady,"
assert t.count(a4) >= 1, "解构锚不唯一"
t = t.replace(a4, "        onVibratoAdjustReady,\n        onVibratoDiag,", 1)

# flush 的两个分叉回传
a5 = """            const last = lastVibratoRef.current;
            if (!p || !last) return;"""
if t.count(a5) == 1:
    t = t.replace(a5, """            const last = lastVibratoRef.current;
            if (!p || !last) {
                onVibratoDiag?.(`flush-skip p:${p ? "Y" : "N"} last:${last ? "Y" : "N"}`);
                return;
            }""", 1)
    print("✓ hook：flush-skip 分叉回传")

a6 = """            vibLog(`flush frames=${densePoints.length} minF=${built.minF} amp=${p.amplitude} freq=${p.frequency}`);"""
if t.count(a6) == 1:
    t = t.replace(a6, """            onVibratoDiag?.(`flush N=${densePoints.length} amp=${Math.round(p.amplitude)}`);
            vibLog(`flush frames=${densePoints.length} minF=${built.minF} amp=${p.amplitude} freq=${p.frequency}`);""", 1)
    print("✓ hook：flush 回传点数")

a7 = """                    vibLog('OK committed');"""
if t.count(a7) == 1:
    t = t.replace(a7, """                    onVibratoDiag?.(`committed N=${densePoints.length}`);
                    vibLog('OK committed');""", 1)
    print("✓ hook：落盘成功回传")

# effect 依赖补上
a8 = """        currentParamRange,
    ]);"""
if t.count(a8) >= 1:
    t = t.replace(a8, """        currentParamRange,
        onVibratoDiag,
    ]);""", 1)

H.write_text(t, encoding="utf-8")
print("✓ hook：onVibratoDiag 已接入")
