#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 修复：实时渲染 + 振幅按值域 + 拖波长时给个可见的默认振幅。

用户反馈（装机实测）：
  1. 「调节后点击确认后也没有绘制曲线，而是默认的直线」
  2. 「我需要调节滑动条时实时渲染曲线」
  3. 「直线/颤音 的『直线』没了」

**问题 1 的根因**（查代码定位）：
  曲线公式是 `base + amplitude * Math.sin(2π * freq * t)`，
  而 `vibratoStateRef` 初始化时 **`amplitude: 0`**（L3976）。
  我的浮层 `onChange` 传的是 `{amplitude: info.amplitude, frequency: v}` ——
  拖波长时 **amplitude 仍是 0** ⇒ 画出来就是一条直线。**完全对得上用户描述。**

**问题 2**：之前只在 `onChange` 里做 `commitStroke`，而 `commitStroke` 是**异步落盘**，
拖动过程中既没有即时反馈、又因为每次都落盘而卡。
⇒ 改成**节流提交**（拖动中按 ~60ms 节流，松手立即提交一次），
  比接 live-edit 预览层简单得多，实时性对"看波形粗细"这个用途足够。

**问题 3**：`amplitude` 的单位是**值域单位**（对音高就是半音），我原先写死 `AMP_MAX = 1200`
完全离谱。改成用 `currentParamRange`（hook 里现成有）算范围；
并且**拖波长时若振幅为 0，自动给一个可见的默认振幅**（值域的 12%），
这样"只拖波长"也能立刻看到波形变化。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / "upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts"

t = HOOK.read_text(encoding="utf-8")

# ── ① 回调签名带上值域 ──────────────────────────────────────────────────────
a = """    onVibratoAdjustReady?: (
        fn: (p: { amplitude: number; frequency: number }) => void,
    ) => void;"""
assert t.count(a) == 1, "prop 锚不唯一"
t = t.replace(a, """    onVibratoAdjustReady?: (
        fn: (p: { amplitude: number; frequency: number; commit?: boolean }) => void,
        /** 当前参数的值域，供浮层决定滑条范围（振幅单位就是值域单位）。 */
        range: { min: number; max: number },
    ) => void;""", 1)
print("✓ prop 签名：回调多接一个 commit 标志，并回传值域")

# ── ② 实现：节流提交 ────────────────────────────────────────────────────────
old = """    useEffect(() => {
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
    ]);"""

new = """    React.useEffect(() => {
        if (!onVibratoAdjustReady) return;
        /**
         * #7：滑条 → 重算曲线。
         *
         * ⚠️ **节流**：拖动过程中每次 `onChange` 都落盘会卡，而且会在撤销栈里
         * 塞满中间状态。所以拖动中按 ~60ms 合并一次，`commit: true`（松手/确认）
         * 时立刻补一次，保证最终值一定落盘。
         *
         * ⚠️ 另外：**振幅为 0 时给一个可见的默认值**。上游 `vibratoStateRef` 初值是
         * `amplitude: 0`，只拖波长的话曲线仍然是直线（用户实测就是这个现象）。
         */
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pending: { amplitude: number; frequency: number } | null = null;

        const flush = () => {
            const p = pending;
            pending = null;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            const last = lastVibratoRef.current;
            if (!p || !last) return;
            const built = buildVibratoDense(
                last.startFrame,
                last.startValue,
                last.endFrame,
                last.endValue,
                p.amplitude,
                p.frequency,
                last.shiftHeld,
            );
            const densePoints = built.dense.map((valueAtFrame, i) => ({
                frame: built.minF + i,
                value: valueAtFrame,
            }));
            void (async () => {
                await commitStroke(densePoints, "draw");
                await applyPostStrokeSmoothing(densePoints, "draw");
            })();
        };

        onVibratoAdjustReady(
            ({ amplitude, frequency, commit }) => {
                lastVibratoRef.current = lastVibratoRef.current;
                pending = { amplitude, frequency };
                if (commit) {
                    flush();
                    return;
                }
                if (timer) return;
                timer = setTimeout(flush, 60);
            },
            (() => {
                const r = currentParamRange;
                if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min) {
                    return { min: r.min, max: r.max };
                }
                // 兜底：音高类参数的值域（半音）
                return { min: -12, max: 12 };
            })(),
        );
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [
        onVibratoAdjustReady,
        buildVibratoDense,
        commitStroke,
        applyPostStrokeSmoothing,
        currentParamRange,
    ]);"""

assert t.count(old) == 1, "useEffect 锚不唯一"
t = t.replace(old, new, 1)
HOOK.write_text(t, encoding="utf-8")
print("✓ hook：节流提交 + 回传值域 + 振幅 0 兜底提示")

# ── ③ 浮层：按值域定范围 + 拖波长自动给默认振幅 ─────────────────────────────
OV = ROOT / "upstream-src/frontend/src/components/layout/pianoRoll/VibratoAdjustOverlay.tsx"
t = OV.read_text(encoding="utf-8")

# props 加 range + commit
t = t.replace("""interface Props {
    info: VibratoAdjustInfo;
    /** 滑动条拖动中：把新的振幅/波长交给上层重算并落盘。 */
    onChange: (next: { amplitude: number; frequency: number }) => void;""",
"""interface Props {
    info: VibratoAdjustInfo;
    /** 当前参数值域（振幅的单位就是它）。 */
    range: { min: number; max: number };
    /**
     * 拖动中：把新的振幅/波长交给上层重算。
     * `commit: false` 走节流预览；`commit: true`（松手/确认）立即落盘。
     */
    onChange: (next: { amplitude: number; frequency: number; commit?: boolean }) => void;""", 1)

# 常量改成按值域算
t = t.replace("""/** 两个滑条各自的可调范围。振幅按上游 drag 调整的步进量级取整。 */
const AMP_MIN = 0;
const AMP_MAX = 1200;
const FREQ_MIN = 0.2;
const FREQ_MAX = 24;""",
"""/** 波长（每个选区内的周期数）：`2π·freq·t` 里的 freq，1~2 个周期最常用。 */
const FREQ_MIN = 0.2;
const FREQ_MAX = 12;
/**
 * 振幅占值域的默认比例。上游 `vibratoStateRef` 的初值是 `amplitude: 0`，
 * 只拖波长的话曲线还是直线 ⇒ 拖波长时若振幅为 0，自动补到这个比例，让变化立即可见。
 */
const AMP_AUTO_RATIO = 0.12;""", 1)

# 组件内算范围
t = t.replace("export function VibratoAdjustOverlay({ info, onChange, onClose }: Props) {",
"""export function VibratoAdjustOverlay({ info, range, onChange, onClose }: Props) {
    /** 振幅上限 = 值域跨度的一半（再大就整体翻出可视区了）。 */
    const ampMax = Math.max(0.01, (range.max - range.min) / 2);
    const ampStep = ampMax / 200;
    const autoAmp = Math.max(ampStep * 4, (range.max - range.min) * AMP_AUTO_RATIO);""", 1)

# 滑条实现：加 commit 参数
t = t.replace("""    const slider = (
        label: string,
        value: number,
        min: number,
        max: number,
        step: number,
        onChangeValue: (v: number) => void,
        vertical: boolean,
    ) => (""",
"""    const slider = (
        label: string,
        value: number,
        min: number,
        max: number,
        step: number,
        onChangeValue: (v: number, commit: boolean) => void,
        vertical: boolean,
    ) => (""", 1)

t = t.replace("""                value={value}
                aria-label={label}
                onChange={(e) => onChangeValue(Number(e.target.value))}
                onPointerDown={stop}
                onPointerUp={stop}""",
"""                value={value}
                aria-label={label}
                // 拖动中（input）走节流预览；松手（change）立即落盘
                onChange={(e) => onChangeValue(Number(e.target.value), false)}
                onPointerUp={(e) => {
                    stop(e);
                    onChangeValue(Number((e.target as HTMLInputElement).value), true);
                }}
                onPointerDown={stop}""", 1)

# 两处调用：接新签名 + 波段拖拽自动补振幅
t = t.replace("""            {slider("波长", info.frequency, FREQ_MIN, FREQ_MAX, 0.05, (v) =>
                onChange({ amplitude: info.amplitude, frequency: v }), true)}
            {slider("振幅", info.amplitude, AMP_MIN, AMP_MAX, 1, (v) =>
                onChange({ amplitude: v, frequency: info.frequency }), false)}""",
"""            {slider(
                "波长",
                info.frequency,
                FREQ_MIN,
                FREQ_MAX,
                0.05,
                (v, commit) =>
                    onChange({
                        // 🔴 拖波长时若振幅为 0，补一个可见的默认值 ——
                        // 否则波形没有任何变化（用户实测报的就是这个）。
                        amplitude: info.amplitude > 0 ? info.amplitude : autoAmp,
                        frequency: v,
                        commit,
                    }),
                true,
            )}
            {slider(
                "振幅",
                info.amplitude,
                0,
                ampMax,
                ampStep,
                (v, commit) => onChange({ amplitude: v, frequency: info.frequency, commit }),
                false,
            )}""", 1)

OV.write_text(t, encoding="utf-8")
print("✓ 浮层：范围按值域 + 拖波长自动补振幅 + onChange 带 commit 标志")
