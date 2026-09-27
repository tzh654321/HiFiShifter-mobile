#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #7 的实测反馈与修复。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊱ #7 实测反馈三连：两个真 bug + 一个概念澄清

用户装机后反馈：
> 直线/颤音 的「直线」没了，调节后点击确认后也没有绘制曲线而是默认的直线，我需要调节滑动条时实时渲染曲线。

### bug 1：「调节后是直线」—— 根因是 `amplitude` 初值为 0

曲线公式（`buildVibratoDense`）：
```ts
const wave = amplitude * Math.sin(2 * Math.PI * safeFreq * t);
dense[f - minF] = snapDrawValue(base + wave, shiftHeld, f);
```

而 `vibratoStateRef` 初始化时 **`amplitude: 0`**（`usePianoRollInteractions.ts` 附近）。
我的浮层 `onChange` 传的是 `{ amplitude: info.amplitude, frequency: v }` ——
**拖波长时 amplitude 仍是 0** ⇒ `wave` 恒为 0 ⇒ 画出来就是直线。**与用户描述完全吻合。**

⇒ 修：**拖波长时若振幅为 0，自动补一个可见的默认振幅**（值域跨度的 12%）。

### bug 2：没有实时渲染 —— 因为只在 onChange 里落盘

原实现每次 `onChange` 都 `await commitStroke(...)`（异步落盘）：
拖动过程中既没有即时反馈，又因为**每次都落盘**而卡，还会往撤销栈里塞满中间状态。

⇒ 修：**节流提交**（拖动中 ~60ms 合并一次，`commit: true` 时立即补一次）。
比接 `applyDenseToLiveEdit` 预览层简单得多，对"看波形粗细"这个用途足够。

### bug 3（真正的 bug）：`AMP_MAX = 1200` 完全离谱

`amplitude` 的单位是**值域单位**（对音高就是半音），我原先写死 `AMP_MAX = 1200`
＝ 1200 个半音。⇒ 改用 hook 里现成的 `currentParamRange` 算范围
（`PianoRollPanel.tsx:1768` 有 `currentParamRange`，也已经传给了 hook）。

### 概念澄清：「直线」和「颤音」上游就是同一个工具

`PianoRollPanel.tsx:931`：
```ts
const currentDrawTool = s.drawToolMode === "line" ? "vibrato" : s.drawToolMode;
```
⇒ **`"line"` 被映射成 `"vibrato"`**。也就是说：**同一条线，振幅 0 就是直线、振幅 > 0 就是颤音**。
「直线/颤音工具」（i18n `vibrato_draw_tool`）是一个工具，不是两个。

⚠️ 所以用户说的「直线没了」**需要进一步确认**指的是什么 ——
可能是：① 画完直线后浮层弹出来，他以为直线模式被替换了；
② 工具按钮的图标/名称显示变了；③ 别的。
**不能凭猜改**（这个项目已经因为"猜"白费过几轮）。

### 🕳️ 又踩了「括号」和「React 引用」

给 `useEffect` 换实现时：
1. 我的脚本锚写的是 `React.useEffect`，但**上一轮刚把它改成了按需 `useEffect`** ⇒ 断言失败（这次是断言救了我）；
2. 替换后新代码里又用了 `React.useEffect` ⇒ 该文件没有 React 默认导入 ⇒ `TS2686 UMD global`。

⇒ 教训：**改同一个文件的多轮脚本之间会互相影响**，每轮动手前先 `grep` 确认锚的当前形态，
别假定它还和上一轮一样。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊱ 节已追加")
