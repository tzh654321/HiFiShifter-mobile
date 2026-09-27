#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D5 修复：参数编辑器纵向缩放到音域边界后卡住。

## 用户口径（精确复现路径）

> 双指纵向缩放到单边音域上限/下限后继续缩小，正确的效果是**以边界为缩放中心继续缩放**，
> 轨道界面就是正常的。

## 根因（对比两个面板的 `getRowHeightBounds` 得出）

`touchGesture.ts:483-490` 是**共用**的纵向缩放公式：

```ts
const targetRowH = clamp(s.rowHeight0 * ky, rhBounds.min, rhBounds.max);
const rowAtMid0 = (s.scrollTop0 + s.mid0.y) / s.rowHeight0;
const newScrollTop = rowAtMid0 * targetRowH - mid.y;
this.viewport.setVertical(targetRowH, newScrollTop);
```

- **轨道界面**：`getRowHeightBounds()` 直接转给内核 ⇒ 行高有**自己的一套 [min,max]**，
  与"当前值域跨度"无关 ⇒ 能一直缩下去（超出内容只是留白）✅
- **参数编辑器**：`getRowHeightBounds()` 返回很宽的 `{min:0.2, max:1e6}`（行高不设限），
  但行高**经 `setVertical` 换算成 `span = h / rowHeight` 后**，最终交给
  `clampViewport` ⇒ 被钳到 **`[6, absMax - absMin]`** ——
  **span 上限恰好是整个音域宽度** ⇒ 缩到边界后 span 到顶，**rowHeight 再也降不下去**。

⇒ 表现就是用户描述的"缩到单边音域上限/下限后卡住"。

### 附带 bug：`span > range` 时 clamp 区间反转

```ts
const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
```

`span > range` 时 `absMin + span/2 > absMax - span/2` ⇒ **lo > hi**，
`clamp` 的语义未定义（多数实现返回 lo，导致 center 被顶到一侧、画面跳）。

## 修法

1. **放宽 span 上限**：允许放大到 `range * 4`（超出的部分只是留白，
   这与轨道界面的行为一致 —— 用户要的就是"以边界为中心继续缩放"）。
2. **`center` 钳制健壮化**：`lo > hi` 时取区间中点（即 `(absMin+absMax)/2`），
   等价于"值域整体居中"，不会跳也不会 NaN。

⚠️ 这两个都**只放宽、不收紧**，所以不会破坏"缩放到某段后正常浏览"的既有行为。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "PianoRollPanel.tsx")
t = P.read_text(encoding="utf-8")

old = """    function clampViewport(param: ParamName, v: ValueViewport): ValueViewport {
        if (param === "pitch") {
            const absMin = PITCH_MIN_MIDI;
            const absMax = PITCH_MAX_MIDI;
            const span = clamp(v.span, 6, absMax - absMin);
            const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
            return { center, span };
        }
        if (isChildPitchOffsetCentsParam(param)) {
            const absMin = CHILD_PITCH_OFFSET_CENTS_RANGE.min;
            const absMax = CHILD_PITCH_OFFSET_CENTS_RANGE.max;
            const span = clamp(v.span, 100, absMax - absMin);
            const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
            return { center, span };
        }
        if (isChildPitchOffsetDegreesParam(param)) {
            const absMin = CHILD_PITCH_OFFSET_DEGREES_RANGE.min;
            const absMax = CHILD_PITCH_OFFSET_DEGREES_RANGE.max;
            const span = clamp(v.span, 1, absMax - absMin);
            const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
            return { center, span };
        }
        const desc = processorParamsRef.current.find((d) => d.id === param);
        const absMin = desc?.kind.type === "automation_curve" ? desc.kind.min_value : 0;
        const absMax = desc?.kind.type === "automation_curve" ? desc.kind.max_value : 1;
        const range = Math.max(1e-6, absMax - absMin);
        const span = clamp(v.span, range * 0.05, range);
        const center = clamp(v.center, absMin + span / 2, absMax - span / 2);
        return { center, span };
    }"""

new = """    /**
     * 值域视口钳制。
     *
     * 🔴 2026-09-25 修（TASKS #D5）：**span 上限从 `range` 放宽到 `range * 4`**。
     *
     * 用户口径：「双指纵向缩放到单边音域上限/下限后继续缩小，正确的效果是
     * **以边界为缩放中心继续缩放**，轨道界面就是正常的」。
     *
     * 原实现的 span 上限恰好等于整个音域宽度 ⇒ 缩到边界后 span 到顶，
     * 行高（`span = h / rowHeight`）再也降不下去 ⇒ 读作"卡住"。
     * 轨道界面之所以正常，是因为它的行高边界由内核独立给出、与内容跨度无关。
     * 放宽后超出的部分只是留白，与轨道行为一致。
     *
     * ⚠️ 同时修掉一个潜伏 bug：`span > range` 时 `absMin + span/2 > absMax - span/2`
     * ⇒ `clamp` 的 lo > hi（语义未定义，多数实现返回 lo ⇒ center 被顶到一侧、画面跳）。
     * 现在 lo > hi 时取区间中点 = 值域整体居中。
     */
    function clampSpanCenter(
        v: ValueViewport,
        absMin: number,
        absMax: number,
        minSpan: number,
    ): ValueViewport {
        const range = Math.max(1e-6, absMax - absMin);
        const span = clamp(v.span, minSpan, range * 4);
        const lo = absMin + span / 2;
        const hi = absMax - span / 2;
        const center = lo > hi ? (absMin + absMax) / 2 : clamp(v.center, lo, hi);
        return { center, span };
    }

    function clampViewport(param: ParamName, v: ValueViewport): ValueViewport {
        if (param === "pitch") {
            return clampSpanCenter(v, PITCH_MIN_MIDI, PITCH_MAX_MIDI, 6);
        }
        if (isChildPitchOffsetCentsParam(param)) {
            return clampSpanCenter(
                v,
                CHILD_PITCH_OFFSET_CENTS_RANGE.min,
                CHILD_PITCH_OFFSET_CENTS_RANGE.max,
                100,
            );
        }
        if (isChildPitchOffsetDegreesParam(param)) {
            return clampSpanCenter(
                v,
                CHILD_PITCH_OFFSET_DEGREES_RANGE.min,
                CHILD_PITCH_OFFSET_DEGREES_RANGE.max,
                1,
            );
        }
        const desc = processorParamsRef.current.find((d) => d.id === param);
        const absMin = desc?.kind.type === "automation_curve" ? desc.kind.min_value : 0;
        const absMax = desc?.kind.type === "automation_curve" ? desc.kind.max_value : 1;
        const range = Math.max(1e-6, absMax - absMin);
        return clampSpanCenter(v, absMin, absMax, range * 0.05);
    }"""

assert t.count(old) == 1, "clampViewport 锚不唯一"
t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ clampViewport：span 上限放宽到 range*4 + center 钳制健壮化")
