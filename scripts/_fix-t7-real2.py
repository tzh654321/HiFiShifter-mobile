#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 第二步：在注册 effect 之后插入**独立的卸载清理** effect。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = F.read_text(encoding="utf-8")

old = """        invalidate,
    ]);

    useEffect(() => {
        if (isDrawToolMode(toolMode)) {"""

new = """        invalidate,
    ]);

    /* #7：**节流定时器的清理单独放这里**（空依赖 ⇒ 只在组件真正卸载时跑一次）。
     *
     * 上面那个 effect 会被 `currentParamRange` 的变化反复重跑，
     * 清理若跟它绑在一起，就会**清掉正在等待的 60ms flush** ⇒ 拖动中曲线不更新。
     * 见上面那段 🔴🔴🔴 注释。 */
    useEffect(
        () => () => {
            if (vibAdjustTimerRef.current.value) {
                clearTimeout(vibAdjustTimerRef.current.value);
                vibAdjustTimerRef.current.value = null;
            }
        },
        [],
    );

    useEffect(() => {
        if (isDrawToolMode(toolMode)) {"""

assert t.count(old) == 1, f"锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
F.write_text(t, encoding="utf-8")
print("✓ ② 独立的卸载清理 effect 已插入")
