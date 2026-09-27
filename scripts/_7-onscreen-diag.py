#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7「曲线不变」：把调试状态**显示在浮层上**，绕开日志依赖。

日志两次不落地（`console.*` 不转发；改用 `invoke("log_frontend_error")` 后真机里
`HS-VIB` 依然为空 —— 说明打点本身就没跑到，或者 invoke 那条路也有问题）。
**再猜下去没意义** ⇒ 直接在浮层顶部渲染一行状态：

    ref:✓ last:✓ flush:12

* `ref` = `vibratoAdjustFnRef.current` 是否已注入（浮层能不能指挥 hook 重算）
* `last` = `lastVibratoRef.current` 是否记住了那条线
* `flush:N` = 最近一次重算的点数（0 表示没触发过）

用户拖一下滑条、截个图，断点在哪一目了然，**不用日志、不用 CDP**。
定完位就把这行删掉。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 浮层：接收并显示 diag ──────────────────────────────────────────────────
OV = FE / "components" / "layout" / "pianoRoll" / "VibratoAdjustOverlay.tsx"
t = OV.read_text(encoding="utf-8")

t = t.replace("""interface Props {
    info: VibratoAdjustInfo;""", """interface Props {
    info: VibratoAdjustInfo;
    /** 临时诊断串（定位「拖滑条曲线不变」，定完即删）。 */
    diag?: string;""", 1)

t = t.replace("export function VibratoAdjustOverlay({ info, range, onChange }: Props) {",
              "export function VibratoAdjustOverlay({ info, range, onChange, diag }: Props) {", 1)

# 在面板最上方插一行诊断显示
old_head = """            onPointerDown={stop}
            onPointerUp={stop}
        >
            {slider("""
new_head = """            onPointerDown={stop}
            onPointerUp={stop}
        >
            {diag ? (
                <div
                    style={{
                        fontSize: 9,
                        lineHeight: "12px",
                        opacity: 0.75,
                        marginBottom: 3,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--accent-9)",
                        wordBreak: "break-all",
                    }}
                >
                    {diag}
                </div>
            ) : null}
            {slider("""
assert t.count(old_head) == 1, "面板头锚不唯一"
t = t.replace(old_head, new_head, 1)
OV.write_text(t, encoding="utf-8")
print("✓ 浮层：新增 diag 显示行")

# ── ② PianoRollPanel：维护 diag 串并传入 ─────────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

# 加一个 diag state
old_state = """    const vibratoAdjustFnRef = React.useRef<
        ((p: { amplitude: number; frequency: number; commit?: boolean }) => void) | null
    >(null);"""
assert t.count(old_state) == 1, "ref 锚不唯一"
t = t.replace(old_state, old_state + """

    /** 临时诊断串：定位「拖滑条曲线不变」。定完即删。 */
    const [vibratoDiag, setVibratoDiag] = React.useState("");""", 1)

# onChange 里更新 diag
old_onchange = """            onChange={(next) => {
                vibratoAdjustFnRef.current?.(next);
                // 浮层上的数值同步更新，拖动时读数才不会跳回旧值
                setVibratoAdjust((prev) => (prev ? { ...prev, ...next } : prev));
            }}"""
assert t.count(old_onchange) == 1, "onChange 锚不唯一"
t = t.replace(old_onchange, """            onChange={(next) => {
                const hasFn = Boolean(vibratoAdjustFnRef.current);
                setVibratoDiag(`ref:${hasFn ? "Y" : "N"} amp:${Math.round(next.amplitude)} fq:${next.frequency.toFixed(2)}`);
                vibratoAdjustFnRef.current?.(next);
                // 浮层上的数值同步更新，拖动时读数才不会跳回旧值
                setVibratoAdjust((prev) => (prev ? { ...prev, ...next } : prev));
            }}""", 1)

t = t.replace("""        <VibratoAdjustOverlay
            info={vibratoAdjust}""", """        <VibratoAdjustOverlay
            info={vibratoAdjust}
            diag={vibratoDiag}""", 1)

PP.write_text(t, encoding="utf-8")
print("✓ PianoRollPanel：维护 diag 串（ref 是否注入 + 当前值）")

# ── ③ hook：把 flush 结果也回传（用同一行显示）────────────────────────────────
H = FE / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = H.read_text(encoding="utf-8")
old_sig = """    onVibratoAdjustReady?: (
        fn: (p: { amplitude: number; frequency: number; commit?: boolean }) => void,
        /** 当前参数的值域，供浮层决定滑条范围（振幅单位就是值域单位）。 */
        range: { min: number; max: number },
    ) => void;"""
assert t.count(old_sig) == 1, "prop 签名锚不唯一"
t = t.replace(old_sig, """    onVibratoAdjustReady?: (
        fn: (p: { amplitude: number; frequency: number; commit?: boolean }) => void,
        /** 当前参数的值域，供浮层决定滑条范围（振幅单位就是值域单位）。 */
        range: { min: number; max: number },
    ) => void;
    /** 临时诊断：把重算/落盘的结果回给上层显示。定完即删。 */
    onVibratoDiag?: (msg: string) => void;""", 1)
H.write_text(t, encoding="utf-8")
print("✓ hook：加 onVibratoDiag prop")

# 在 flush 的每个分叉点回传
t = H.read_text(encoding="utf-8")
t = t.replace("""            const last = lastVibratoRef.current;
            if (!p || !last) return;""",
"""            const last = lastVibratoRef.current;
            if (!p || !last) {
                onVibratoDiag?.(`flush skipped p:${p ? "Y" : "N"} last:${last ? "Y" : "N"}`);
                return;
            }""", 1)
t = t.replace("""            void (async () => {
                try {
                    await commitStroke(densePoints, "draw");
                    await applyPostStrokeSmoothing(densePoints, "draw");
                    vibLog('OK committed');
                } catch (err) {
                    vibLog(`X commit failed: ${String(err)}`);
                }
            })();""",
"""            onVibratoDiag?.(`flush N=${densePoints.length} amp=${Math.round(p.amplitude)}`);
            void (async () => {
                try {
                    await commitStroke(densePoints, "draw");
                    await applyPostStrokeSmoothing(densePoints, "draw");
                    onVibratoDiag?.(`committed N=${densePoints.length}`);
                } catch (err) {
                    onVibratoDiag?.(`ERR ${String(err).slice(0, 40)}`);
                }
            })();""", 1)
H.write_text(t, encoding="utf-8")
print("✓ hook：flush 各分叉回传诊断")
