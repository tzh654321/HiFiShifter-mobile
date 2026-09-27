#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 真根因：**effect 的 cleanup 把进行中的节流 timer 清掉了**。

## 现象

拖动滑条时曲线不动，**松手才更新一次**。

## 调用链

```
<input type=range onChange>          → onChangeValue(v, /*commit*/ false)   拖动中
<input type=range onPointerUp>       → onChangeValue(v, /*commit*/ true)    松手
        ↓
onVibratoAdjustReady({ amplitude, frequency, commit })
        ↓
  pending.value = {...}
  if (commit) { flush(); return; }        // 松手：立即 flush ⇒ 曲线更新 ✅
  if (timer.value) return;               // 已有 timer ⇒ 直接返回（正确节流）
  timer.value = setTimeout(flush, 60);   // 否则起一个 60ms 的 timer
```

## 根因

这个 `onVibratoAdjustReady` 注册所在的 `useEffect` **依赖数组里有 `currentParamRange`**，
而它在拖动过程中会变化 ⇒ **effect 重跑** ⇒ React 先执行上一个 effect 的 cleanup：

```ts
return () => {
    if (timer.value) { clearTimeout(timer.value); timer.value = null; }   // ← 凶器
};
```

⇒ 那个刚起好的 60ms timer **被清掉了** ⇒ `flush` 永远不跑
⇒ 唯一能更新曲线的路径只剩松手时的 `commit: true`。

⚠️ 注释里写着「已改成 useRef 就不会被清了」—— **这是误判**：
`useRef` 只是让变量跨 effect 存活，**cleanup 照样能把它指向的 timer 清掉**，
反而因为 timer 是共享的，effect 重跑时更容易误伤正在等待的那个。

## 修法

**定时器的生命周期不该和这个 effect 绑定**：

- 这个 effect 只负责**注册回调**（依赖该变的还得变）；
- 清理放进**一个独立的空依赖 effect**（只在组件真正卸载时跑一次）。

这样 `currentParamRange` 变化导致的重跑**不会再碰 timer**，节流按预期 60ms 一次。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts"
t = F.read_text(encoding="utf-8")

# ── ① 把清理从「注册 effect」里摘掉 ─────────────────────────────────────
old_cleanup = """        return () => {
            if (timer.value) {
                clearTimeout(timer.value);
                timer.value = null;
            }
        };
    }, [
        onVibratoAdjustReady,
        buildVibratoDense,
        commitStroke,
        applyPostStrokeSmoothing,
        currentParamRange,
        onVibratoDiag,
        paramViewRef,
        ensureLiveEditBase,
        applyDenseToLiveEdit,"""

new_cleanup = """        /* 🔴🔴🔴 #7 真根因（第二版）：**这里绝不能清 timer**。
         *
         * 本 effect 的依赖里有 `currentParamRange`，它**在拖动过程中会变化**
         * ⇒ effect 重跑 ⇒ React 先跑上一轮的 cleanup ⇒ 刚起好的 60ms 节流 timer
         * 被 `clearTimeout` ⇒ `flush` 永远不跑 ⇒ **曲线只在松手（commit:true）时更新**
         * —— 用户报的「松手才更新一次」就是这个。
         *
         * ⚠️ 上一版以为"改成 useRef 就安全了"是**误判**：useRef 只让变量跨 effect 存活，
         * cleanup 照样能把它指向的 timer 清掉；而且因为 timer 是共享的，
         * effect 重跑时更容易误伤正在等待的那一个。
         *
         * ⇒ 定时器的生命周期**与这个 effect 解耦**，清理挪到下面那个空依赖 effect 里
         *   （只在组件真正卸载时跑一次）。
         */
    }, [
        onVibratoAdjustReady,
        buildVibratoDense,
        commitStroke,
        applyPostStrokeSmoothing,
        currentParamRange,
        onVibratoDiag,
        paramViewRef,
        ensureLiveEditBase,
        applyDenseToLiveEdit,"""

assert t.count(old_cleanup) == 1, f"① 锚命中 {t.count(old_cleanup)}"
t = t.replace(old_cleanup, new_cleanup, 1)
print("✓ ① 从注册 effect 里摘掉 cleanup")

F.write_text(t, encoding="utf-8")
# 说明第二段（空依赖 effect）由下一步脚本插入，因为要定位 effect 的结尾
print("  · 下一步：在 effect 之后插入独立的卸载清理 effect")
