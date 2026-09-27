#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 收尾（用户确认曲线已生效后的 7 项调整）。

1. **隐藏调试信息**（`diag` 那一行）
2. **振幅要小数** —— 原步进 `ampMax/200` 太粗（读到 26/29 都是整数）
3. **滑条下密上疏** —— 用户口径：「多数情况用颤音只会用到 2 以内但偶尔会需要几十」
   ⇒ 用**幂曲线**映射：滑条位置 t∈[0,1] ⇒ 实际值 = `ampMax · t^k`（k=3）。
   t 小（下部）时值变化慢 ⇒ 精细（2 以内占足行程）；t 大时能快速到几十。
4. **拖动时实时渲染**（用户说现在"松手才渲染"）
   ⚠️ 根因：我上一版把 `timer`/`pending` 放在 `useEffect` **内部**，
   而 effect 依赖里的 `currentParamRange` 会频繁变化 ⇒ effect 重跑 ⇒ **cleanup 把 timer 清掉**
   ⇒ 节流的 flush **永远等不到**，只有松手那次 `commit:true` 的立即 flush 生效。
   ⇒ 修：把 timer/pending 提到 **`useRef`**，不受 effect 重跑影响。
5. **播放不再关闭浮层** —— 点播放按钮被判成"点击框外"。
   ⇒ 判定收紧：**任何 `<button>` / `role=button` 被点到都不算空白**（最可靠）。
6. **「波长」「振幅」标签用主题色**（`--accent-9`）
7. 工具名确认仍是「直线/颤音」（未改）
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ══ ① 浮层：去 diag、振幅小数+幂映射、标签主题色 ════════════════════════════
OV = FE / "components" / "layout" / "pianoRoll" / "VibratoAdjustOverlay.tsx"
t = OV.read_text(encoding="utf-8")

# 1) 去掉 diag prop 与显示块
t = t.replace("""    /** 临时诊断串（定位「拖滑条曲线不变」，定完即删）。 */
    diag?: string;
""", "", 1)
t = t.replace("export function VibratoAdjustOverlay({ info, range, onChange, diag }: Props) {",
              "export function VibratoAdjustOverlay({ info, range, onChange }: Props) {", 1)
t = t.replace("""            {diag ? (
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
""", "", 1)
print("✓ 去掉调试信息显示")

# 2) 幂映射 + 小数步进
old_map = """    /** 振幅上限 = 值域跨度的一半（再大就整体翻出可视区了）。 */
    const ampMax = Math.max(0.01, (range.max - range.min) / 2);
    const ampStep = ampMax / 200;
    const autoAmp = Math.max(ampStep * 4, (range.max - range.min) * AMP_AUTO_RATIO);"""
new_map = """    /** 振幅上限 = 值域跨度的一半（再大就整体翻出可视区了）。 */
    const ampMax = Math.max(0.01, (range.max - range.min) / 2);
    /**
     * 滑条是**线性位置**，但振幅要「下密上疏」：
     * 用户口径「多数情况只会用到 2 以内，但偶尔会需要几十」。
     * ⇒ 位置 t∈[0,1] 映射到值 `ampMax · t^k`（k=3）：
     *   t=0.5 ⇒ 只有 ampMax/8 —— 一半的行程都用来精细调小值。
     */
    const AMP_CURVE_K = 3;
    const SLIDER_STEPS = 1000; // 位置分辨率
    const posToAmp = (pos: number) => ampMax * Math.pow(pos / SLIDER_STEPS, AMP_CURVE_K);
    const ampToPos = (amp: number) =>
        Math.round(SLIDER_STEPS * Math.pow(Math.max(0, amp) / ampMax, 1 / AMP_CURVE_K));
    const autoAmp = Math.max(ampMax * 0.01, (range.max - range.min) * AMP_AUTO_RATIO);"""
assert t.count(old_map) == 1, "映射锚不唯一"
t = t.replace(old_map, new_map, 1)
print("✓ 振幅：幂映射（下密上疏）+ 小数")

# 3) 标签/数值用主题色
t = t.replace("""            <span style={{ fontSize: 10.5, width: 26, opacity: 0.75, flexShrink: 0 }}>{label}</span>""",
"""            <span
                style={{
                    fontSize: 10.5,
                    width: 26,
                    flexShrink: 0,
                    // 用户口径：「波长」「振幅」用主题色
                    color: "var(--accent-9)",
                    fontWeight: 600,
                }}
            >
                {label}
            </span>""", 1)
print("✓ 标签改用主题色")

# 4) 振幅滑条改为按位置驱动 + 显示 2 位小数
old_amp = """            {slider(
                "振幅",
                info.amplitude,
                0,
                ampMax,
                ampStep,
                (v, commit) => onChange({ amplitude: v, frequency: info.frequency, commit }),
                false,
            )}"""
new_amp = """            {slider(
                "振幅",
                ampToPos(info.amplitude),
                0,
                SLIDER_STEPS,
                1,
                (pos, commit) =>
                    onChange({
                        amplitude: posToAmp(pos),
                        frequency: info.frequency,
                        commit,
                    }),
                false,
            )}"""
assert t.count(old_amp) == 1, "振幅滑条锚不唯一"
t = t.replace(old_amp, new_amp, 1)

# 数值显示：振幅 2 位小数
t = t.replace("""                {vertical ? value.toFixed(2) : Math.round(value)}""",
              """                {vertical ? value.toFixed(2) : (value / SLIDER_STEPS).toFixed(3)}""", 1)
print("✓ 振幅滑条：位置驱动 + 3 位小数读数")

OV.write_text(t, encoding="utf-8")

# ══ ② PianoRollPanel：去 diag、收紧"框外"判定（button 不算空白）════════════
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

t = t.replace("""    /** 临时诊断串：定位「拖滑条曲线不变」。定完即删。 */
    const [vibratoDiag, setVibratoDiag] = React.useState("");
""", "", 1)
t = t.replace("""            diag={vibratoDiag}
""", "", 1)
t = t.replace("""            onChange={(next) => {
                setVibratoDiag(
                    `ref:${vibratoAdjustFnRef.current ? "Y" : "N"} amp:${Math.round(next.amplitude)} fq:${next.frequency.toFixed(2)}`,
                );
                vibratoAdjustFnRef.current?.(next);""",
"""            onChange={(next) => {
                vibratoAdjustFnRef.current?.(next);""", 1)
t = t.replace("        onVibratoDiag: setVibratoDiag,\n", "", 1)
print("✓ PianoRollPanel：调试信息已移除")

# 收紧"框外"判定：任何 button 都不算空白
old_keep2 = """        const KEEP_SELECTORS = ["""
new_keep2 = """        const KEEP_SELECTORS = [
            /* 用户口径修正：**点播放按钮不该关闭浮层**（调曲线时要边听边调）。
               最可靠的办法是把所有可交互控件都排除掉 —— 按钮、滑杆、输入框等。 */
            'button',
            '[role="button"]',
            'input',
            'select',
            '[role="slider"]',
            '[role="menu"]',
            '[role="menubar"]',
            '[data-radix-popper-content-wrapper]',
            '[data-radix-menu-content]',"""
assert t.count(old_keep2) == 1, "KEEP 锚不唯一"
t = t.replace(old_keep2, new_keep2, 1)
PP.write_text(t, encoding="utf-8")
print("✓ 点框外判定：button/input 等一律不算空白（播放不会再关浮层）")

# ══ ③ hook：timer/pending 提到 useRef（修「松手才渲染」）═════════════════════
H = FE / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = H.read_text(encoding="utf-8")

old_fx = """        let timer: ReturnType<typeof setTimeout> | null = null;
        let pending: { amplitude: number; frequency: number } | null = null;

        const flush = () => {
            const p = pending;
            pending = null;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }"""
new_fx = """        /**
         * 🔴 修「松手才渲染」：timer/pending **必须放 useRef**。
         *
         * 上一版是 effect 内的局部变量，而本 effect 的依赖里含 `currentParamRange` ——
         * 它会在拖动过程中变化 ⇒ effect 重跑 ⇒ cleanup 把 timer 清掉
         * ⇒ 节流的 flush **永远等不到**，表现就是"只有松手那次 commit:true 才渲染"。
         */
        const timer = vibAdjustTimerRef.current;
        const pending = vibAdjustPendingRef.current;

        const flush = () => {
            const p = pending.value;
            pending.value = null;
            if (timer.value) {
                clearTimeout(timer.value);
                timer.value = null;
            }"""
assert t.count(old_fx) == 1, "timer 锚不唯一"
t = t.replace(old_fx, new_fx, 1)

t = t.replace("""                pending = { amplitude, frequency };
                if (commit) {
                    flush();
                    return;
                }
                if (timer) return;
                timer = setTimeout(flush, 60);""",
"""                pending.value = { amplitude, frequency };
                if (commit) {
                    flush();
                    return;
                }
                if (timer.value) return;
                timer.value = setTimeout(flush, 60);""", 1)

t = t.replace("""        return () => {
            if (timer) clearTimeout(timer);
        };""",
"""        return () => {
            if (timer.value) {
                clearTimeout(timer.value);
                timer.value = null;
            }
        };""", 1)

# 在 lastVibratoRef 旁声明这两个 ref
old_ref_anchor = """    const lastVibratoRef = useRef<{
        startFrame: number;"""
assert t.count(old_ref_anchor) == 1, "lastVibratoRef 锚不唯一"
t = t.replace(old_ref_anchor, """    /** #7 节流用（放 ref，避免 effect 重跑把 timer 清掉 ⇒ 拖动时能实时渲染）。 */
    const vibAdjustTimerRef = useRef<{ value: ReturnType<typeof setTimeout> | null }>({ value: null });
    const vibAdjustPendingRef = useRef<{
        value: { amplitude: number; frequency: number } | null;
    }>({ value: null });

    const lastVibratoRef = useRef<{
        startFrame: number;""", 1)
H.write_text(t, encoding="utf-8")
print("✓ hook：节流改 useRef（拖动中实时渲染）")
