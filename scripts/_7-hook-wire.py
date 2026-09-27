#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 第 2 步：给 usePianoRollInteractions 接上「画完 → 弹浮层」和「滑条 → 重算落盘」。

关键发现（读代码得出的，比原方案简单）：
  · `vibratoStateRef` 虽有五处清空，但**只有一处是"提交"**（`commitStroke` 之后）——
    其余四处都是 `onCancel`（OS 取消手势，明确"不写后端"）⇒ **钩子只挂一处**。
  · **不需要新建后端通道**：调整时直接 `buildVibratoDense` + `commitStroke` 覆盖即可。

⚠️ 第一版我犯了个错：重算时把 `startValue`/`currentValue` 传了 0 ⇒ 会把线的走向也改掉。
正确做法是**在 hook 内记住最近一条线的完整参数**（含两端值），浮层只负责改
`amplitude`/`frequency` 两个数 ⇒ 用 `lastVibratoRef` 保存，浮层回调只传这两个值。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

# ── ① 两个 prop ─────────────────────────────────────────────────────────────
a = '    onCycleDragDirection?: (tool: "select" | "draw" | "vibrato") => void;'
assert t.count(a) == 1, "props 锚不唯一"
t = t.replace(a, a + """
    /**
     * #7：直线/颤音**画完并提交后**回调，上层据此弹出「波长/振幅」双滑条浮层。
     * 只在真正落盘（`commitStroke`）之后触发 —— `onCancel` 那几处不算（半截笔画不写后端）。
     */
    onVibratoCommitted?: (info: {
        startFrame: number;
        endFrame: number;
        amplitude: number;
        frequency: number;
        clientX: number;
        clientY: number;
    }) => void;
    /**
     * #7：把「只改波形参数」的能力交给上层（浮层拖滑条时调）。
     * 线的两端值由 hook 自己从 `lastVibratoRef` 取，**保证只改振幅/波长、不改走向**。
     */
    onVibratoAdjustReady?: (
        fn: (p: { amplitude: number; frequency: number }) => void,
    ) => void;""", 1)
print("✓ 两个 prop 已加入类型")

# ── ② 解构 ───────────────────────────────────────────────────────────────────
a2 = "        onCycleDragDirection,"
assert t.count(a2) >= 1, "解构锚不唯一"
t = t.replace(a2, "        onCycleDragDirection,\n        onVibratoCommitted,\n        onVibratoAdjustReady,", 1)
print("✓ 参数已解构")

# ── ③ 记住最近一条线的完整参数 ───────────────────────────────────────────────
a3 = "    const VIBRATO_DRAG_CAPTURE_ATTR = \"data-piano-roll-vibrato-drag-active\";"
assert t.count(a3) == 1, "ref 锚不唯一"
t = t.replace(a3, """    const VIBRATO_DRAG_CAPTURE_ATTR = "data-piano-roll-vibrato-drag-active";
    /**
     * #7：最近一条**已提交**的颤音线的完整参数（含两端值）。
     * 浮层拖滑条时只改 amplitude/frequency，其余从这儿取 ——
     * 否则重建时端点值给 0 会把线的走向也改掉。
     */
    const lastVibratoRef = useRef<{
        startFrame: number;
        startValue: number;
        endFrame: number;
        endValue: number;
        shiftHeld: boolean;
    } | null>(null);""", 1)
print("✓ lastVibratoRef 已加")

# ── ④ 提交后回调 + 记录参数 ─────────────────────────────────────────────────
a4 = """                    })();
                    vibratoStateRef.current = null;
                    setVibratoDragCaptureActive(false);
                };"""
assert t.count(a4) == 1, "提交收尾锚不唯一"
t = t.replace(a4, """                    })();
                    // #7：只有这里是"画完并提交"（其余四处是 onCancel，不写后端）。
                    // `vib` 已在上面捕获，此处读仍然有效。
                    if (isVibratoTool && vib && st.mode === "draw") {
                        lastVibratoRef.current = {
                            startFrame: vib.startFrame,
                            startValue: vib.startValue,
                            endFrame: vib.currentFrame,
                            endValue: vib.currentValue,
                            shiftHeld: vib.shiftHeld,
                        };
                        onVibratoCommitted?.({
                            startFrame: vib.startFrame,
                            endFrame: vib.currentFrame,
                            amplitude: vib.amplitude,
                            frequency: vib.frequency,
                            clientX: Number((e as PointerEvent).clientX) || 0,
                            clientY: Number((e as PointerEvent).clientY) || 0,
                        });
                    }
                    vibratoStateRef.current = null;
                    setVibratoDragCaptureActive(false);
                };""", 1)
print("✓ 提交后回调已挂钩")

# ── ⑤ 暴露"只改波形参数"的能力（挂在 buildVibratoDense 依赖数组之后）────────
a5 = "            buildVibratoDense,"
assert t.count(a5) >= 1
idx = t.index(a5)
tail = t.index("\n        ],", idx)
tail_end = tail + len("\n        ],\n")
t = t[:tail_end] + """
    /**
     * #7：浮层拖滑条 ⇒ 只改振幅/波长，**线的走向不变**。
     * 两端值取 `lastVibratoRef`，重建密集点后走既有 `commitStroke` 覆盖落盘。
     */
    React.useEffect(() => {
        if (!onVibratoAdjustReady) return;
        onVibratoAdjustReady(({ amplitude, frequency }) => {
            const last = lastVibratoRef.current;
            if (!last) return;
            void (async () => {
                const built = buildVibratoDense(
                    last.startFrame,
                    last.startValue,
                    last.endFrame,
                    last.endValue,
                    amplitude,
                    frequency,
                    last.shiftHeld,
                );
                const densePoints = built.dense.map((valueAtFrame, i) => ({
                    frame: built.minF + i,
                    value: valueAtFrame,
                }));
                await commitStroke(densePoints, "draw");
                await applyPostStrokeSmoothing(densePoints, "draw");
            })();
        });
    }, [
        onVibratoAdjustReady,
        buildVibratoDense,
        commitStroke,
        applyPostStrokeSmoothing,
    ]);
""" + t[tail_end:]
print("✓ onVibratoAdjustReady 已暴露（只改波形参数，不动走向）")

P.write_text(t, encoding="utf-8")
print("\n下一步：PianoRollPanel 传这两个 prop + 渲染浮层 + 点空白关闭")
