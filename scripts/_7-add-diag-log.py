#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 加诊断日志：定位「画完颤音线后浮层不弹」到底卡在哪一步。

前情：我用 CDP 合成事件**始终无法进入 vibrato 模式**（长按铅笔开不出工具子菜单），
所以端到端验证做不了。⇒ 改成打日志，让**用户用真机正常操作一次**，再看 `logs/android.log`。

打点处（覆盖整条链路，一次就能分清断在哪）：
  1. `onUp` 收尾进入 vibrato 分支前 ⇒ 记录 `isVibratoTool` / `vib` 是否存在 / `st.mode`
  2. 提交后回调 `onVibratoCommitted` 是否被调
  3. `onVibratoAdjustReady` 这个 effect 是否跑过（浮层能否拿到重算能力）
  4. 滑条回调（adjust）是否被触发

日志用 `console.warn`：`App.tsx` 会把前端的 warn/error 转发到后端日志
（`backend_lib::commands::diagnostics`），所以真机上 `run-as … cat logs/android.log` 就能看到。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

# ── 打点 1：进入 vibrato 判定 ────────────────────────────────────────────────
a1 = """                    void (async () => {
                        if (isVibratoTool && vib && st.mode === "draw") {"""
assert t.count(a1) == 1, "打点1 锚不唯一"
t = t.replace(a1, """                    // [HS-VIB] 打点1：进没进 vibrato 分支
                    console.warn(
                        `[HS-VIB] pointerup tool=${String(toolMode)} isVibrato=${String(isVibratoTool)} ` +
                            `hasVib=${String(Boolean(vib))} mode=${String(st.mode)}`,
                    );
                    void (async () => {
                        if (isVibratoTool && vib && st.mode === "draw") {""", 1)
print("✓ 打点1：vibrato 分支判定")

# ── 打点 2：提交后回调 ──────────────────────────────────────────────────────
a2 = """                    if (isVibratoTool && vib && st.mode === "draw") {
                        lastVibratoRef.current = {"""
assert t.count(a2) == 1, "打点2 锚不唯一"
t = t.replace(a2, """                    if (isVibratoTool && vib && st.mode === "draw") {
                        // [HS-VIB] 打点2：钩子命中，准备通知上层弹浮层
                        console.warn(
                            `[HS-VIB] committed start=${vib.startFrame} end=${vib.currentFrame} ` +
                                `amp=${vib.amplitude} freq=${vib.frequency} hasCb=${String(Boolean(onVibratoCommitted))}`,
                        );
                        lastVibratoRef.current = {""", 1)
print("✓ 打点2：提交后回调")

# ── 打点 3：effect 是否跑过 ─────────────────────────────────────────────────
a3 = """    useEffect(() => {
        if (!onVibratoAdjustReady) return;
        /**"""
assert t.count(a3) == 1, "打点3 锚不唯一"
t = t.replace(a3, """    useEffect(() => {
        console.warn(
            `[HS-VIB] adjustReady effect run hasCb=${String(Boolean(onVibratoAdjustReady))}`,
        );
        if (!onVibratoAdjustReady) return;
        /**""", 1)
print("✓ 打点3：adjustReady effect")

# ── 打点 4：滑条回调 ────────────────────────────────────────────────────────
a4 = """                onVibratoAdjustReady(
            ({ amplitude, frequency, commit }) => {"""
if t.count(a4) != 1:
    # 缩进可能不同，退一步找
    a4 = "({ amplitude, frequency, commit }) => {"
assert t.count(a4) >= 1, "打点4 锚不唯一"
t = t.replace(a4, """({ amplitude, frequency, commit }) => {
                console.warn(
                    `[HS-VIB] slider amp=${amplitude} freq=${frequency} commit=${String(commit)} hasLast=${String(Boolean(lastVibratoRef.current))}`,
                );""", 1)
print("✓ 打点4：滑条回调")

P.write_text(t, encoding="utf-8")
print("\n下一步：构建 arm64 → 装真机 → 用户操作一次 → 读 logs/android.log 里的 [HS-VIB]")
