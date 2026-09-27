#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 诊断 v2：真机实测发现「滑条能动、曲线不变」。

真机证据（截图 0046 / 0048）：
  · 画完线后**浮层正常弹出**（波长/振幅两个滑条 + 完成键）—— 说明 **入口 + 钩子都通了**！
  · 拖振幅滑条：读数 **26 → 42** 变了 ⇒ **滑条的 onChange 也确实被调到了**。
  · **但曲线仍然是直线** ⇒ 断点就在「onChange → 重算 → 落盘」这一段。

⚠️ 上一版日志用 `console.warn`，**没被转发到后端**（`App.tsx` 只转发 uncaught error）。
⇒ 改成 **`console.error`**（会走 `[frontend] Uncaught error` 那条通道），
   并且在关键分叉处打印**具体原因**（ref 是否为 null、last 是否为 null、commitStroke 前后）。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

# 统一换成 console.error（会被 App.tsx 转发）
n = t.count("console.warn(\n                        `[HS-VIB]")
t = t.replace("console.warn(\n                        `[HS-VIB]", "console.error(\n                        `[HS-VIB]")
t = t.replace("console.warn(\n            `[HS-VIB]", "console.error(\n            `[HS-VIB]")
t = t.replace("console.warn(\n                `[HS-VIB]", "console.error(\n                `[HS-VIB]")
t = t.replace("console.warn(\n                    `[HS-VIB]", "console.error(\n                    `[HS-VIB]")
t = t.replace("console.warn(`[HS-VIB]", "console.error(`[HS-VIB]")
print(f"✓ 已把 HS-VIB 日志改为 console.error（原 warn 命中 {n} 处）")

# 在滑条回调里加细粒度诊断
a = """({ amplitude, frequency, commit }) => {
                console.error(
                    `[HS-VIB] slider amp=${amplitude} freq=${frequency} commit=${String(commit)} hasLast=${String(Boolean(lastVibratoRef.current))}`,
                );
                const last = lastVibratoRef.current;
                if (!last) return;"""
assert t.count(a) == 1, "滑条回调锚不唯一"
t = t.replace(a, """({ amplitude, frequency, commit }) => {
                const last = lastVibratoRef.current;
                console.error(
                    `[HS-VIB] slider amp=${amplitude} freq=${frequency} commit=${String(commit)} ` +
                        `hasLast=${String(Boolean(last))}`,
                );
                if (!last) {
                    console.error("[HS-VIB] ✗ lastVibratoRef 为空 ⇒ 重算无从下手");
                    return;
                }""", 1)
print("✓ 滑条回调：加了 lastVibratoRef 为空的显式报错")

# 在 flush 里加落盘前后诊断
a2 = """            void (async () => {
                await commitStroke(densePoints, "draw");
                await applyPostStrokeSmoothing(densePoints, "draw");
            })();
        };"""
assert t.count(a2) == 1, "flush 锚不唯一"
t = t.replace(a2, """            console.error(
                `[HS-VIB] flush 准备落盘 frames=${densePoints.length} ` +
                    `minF=${built.minF} amp=${p.amplitude} freq=${p.frequency}`,
            );
            void (async () => {
                try {
                    await commitStroke(densePoints, "draw");
                    await applyPostStrokeSmoothing(densePoints, "draw");
                    console.error("[HS-VIB] ✓ 落盘完成");
                } catch (err) {
                    console.error(`[HS-VIB] ✗ 落盘失败: ${String(err)}`);
                }
            })();
        };""", 1)
print("✓ flush：加了落盘前后诊断 + try/catch")

P.write_text(t, encoding="utf-8")
print("\n下一步：构建 arm64 → 装真机 → 再画一条线并拖滑条 → 读日志")
