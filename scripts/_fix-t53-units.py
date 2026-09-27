#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#53 滑条数值单位：波长 → 秒，振幅 → ±半音。

## 内部参数的真实含义（查过源码，不是猜的）

`buildVibratoDense`（`usePianoRollInteractions.ts:1093`）：

```ts
const wave = amplitude * Math.sin(2 * Math.PI * safeFreq * t);
//                    ↑ 半音（pitch 参数的值域单位）   ↑ t = 归一化 0→1
```

- **振幅**：直接就是 **pitch 参数值** ⇒ 单位 = **半音**（组件自己的注释也写「振幅的单位就是 [`range`]」）；
- **波长 `frequency`**：因为 `t` 是**归一化进度**（不是秒），所以 freq 的含义是
  **「整条线里放多少个完整波」**（注释原话：「每个选区内的周期数」，1~2 最常用）。

⇒ 所以要显示「多少秒」，必须拿**选区时长**：`周期秒数 = 选区秒数 / freq`，
选区秒数 = `(endFrame - startFrame) / 采样率`。项目默认采样率 `48000`
（`utils/timelineSnapping.ts` 的 `DEFAULT_PROJECT_SAMPLE_RATE`）。

## 改法

把 `slider()` 的末参从 `vertical: boolean` 换成 `format: (v) => string`，
让两个滑条各自决定怎么显示 —— 原来的 `vertical` 只用来选显示公式，
换成 formatter 后职责更直接。

⚠️ **只改显示**，滑条的 min/max/step 和内部计算一律不动。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "pianoRoll" / "VibratoAdjustOverlay.tsx"
t = F.read_text(encoding="utf-8")

# ── ① slider() 的末参：vertical:boolean → format:(v)=>string ─────────────
old1 = """        onChangeValue: (v: number, commit: boolean) => void,
        vertical: boolean,
    ) => ("""
new1 = """        onChangeValue: (v: number, commit: boolean) => void,
        /** #53：数值的**显示**格式由调用方决定（单位不同），滑条本身只负责取值。 */
        format: (v: number) => string,
    ) => ("""
assert t.count(old1) == 1, f"① 锚命中 {t.count(old1)}"
t = t.replace(old1, new1, 1)
print("✓ ① slider 末参改为 format")

# ── ② 数值渲染 ──────────────────────────────────────────────────────────
old2 = """                {vertical ? value.toFixed(2) : (value / SLIDER_STEPS).toFixed(3)}"""
new2 = """                {format(value)}"""
assert t.count(old2) == 1, f"② 锚命中 {t.count(old2)}"
t = t.replace(old2, new2, 1)
print("✓ ② 数值渲染改为 format(value)")

# ── ③ 波长：→「秒」 ─────────────────────────────────────────────────────
old3 = """                (v, commit) =>
                    onChange({
                        // 🔴 拖波长时若振幅为 0，补一个可见的默认值 ——
                        // 否则波形没有任何变化（用户实测报的就是这个）。
                        amplitude: info.amplitude > 0 ? info.amplitude : autoAmp,
                        frequency: v,
                        commit,
                    }),
                true,
            )}"""
new3 = """                (v, commit) =>
                    onChange({
                        // 🔴 拖波长时若振幅为 0，补一个可见的默认值 ——
                        // 否则波形没有任何变化（用户实测报的就是这个）。
                        amplitude: info.amplitude > 0 ? info.amplitude : autoAmp,
                        frequency: v,
                        commit,
                    }),
                /* #53 用户口径：波长要显示成「多少秒」。
                 *
                 * `frequency` 是「整条线里的周期数」（见 buildVibratoDense 里
                 * `sin(2π·freq·t)`，t 是归一化进度，**不是秒**）⇒ 一个周期的秒数：
                 *
                 *     周期秒 = 选区秒数 / 周期数 = ((endFrame - startFrame) / 采样率) / freq
                 *
                 * 采样率取项目默认 48000。 */
                (v) => {
                    const secs = (info.endFrame - info.startFrame) / DEFAULT_SAMPLE_RATE;
                    const period = secs > 0 && v > 0 ? secs / v : 0;
                    return `${period.toFixed(3)} s`;
                },
            )}"""
assert t.count(old3) == 1, f"③ 锚命中 {t.count(old3)}"
t = t.replace(old3, new3, 1)
print("✓ ③ 波长 → 秒")

# ── ④ 振幅：→「±半音」 ──────────────────────────────────────────────────
old4 = """                (pos, commit) =>
                    onChange({
                        amplitude: posToAmp(pos),
                        frequency: info.frequency,
                        commit,
                    }),
                false,
            )}"""
new4 = """                (pos, commit) =>
                    onChange({
                        amplitude: posToAmp(pos),
                        frequency: info.frequency,
                        commit,
                    }),
                /* #53 用户口径：振幅显示成「波峰为正负几个半音」。
                 * 振幅本身就是 pitch 参数值 ⇒ 单位就是半音（见本文件 range 的注释）。 */
                (pos) => `±${posToAmp(pos).toFixed(2)} 半音`,
            )}"""
assert t.count(old4) == 1, f"④ 锚命中 {t.count(old4)}"
t = t.replace(old4, new4, 1)
print("✓ ④ 振幅 → ±半音")

# ── ⑤ 引入采样率常量 ────────────────────────────────────────────────────
# 用项目既有常量，避免再造一个会漂移的数字；插在文件顶部 import 之后
old5 = 'import React from "react";'
new5 = ('import React from "react";\n'
        '\n'
        '/* #53：波长要换算成「秒」，需要采样率。用项目既有常量，别自己写 48000。 */\n'
        'import { DEFAULT_PROJECT_SAMPLE_RATE as DEFAULT_SAMPLE_RATE } from "../../../utils/timelineSnapping";')
assert t.count(old5) == 1, f"⑤ 锚命中 {t.count(old5)}"
t = t.replace(old5, new5, 1)
print("✓ ⑤ 引入项目采样率常量")

F.write_text(t, encoding="utf-8")
