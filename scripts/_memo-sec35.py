#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㉟ 节：#7 颤音双滑条浮层的实现。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㉟ #7 直线/颤音双滑条浮层（实现完成，tsc 通过）

用户拍板做它之后，实际比预估顺利 —— **两个发现把工作量砍掉了一大半**。

### 发现 1：五个"清空出口"里只有一个是"提交"

原方案说要挂五个钩子（我一开始也是这么评估的）。读代码后发现：

| 位置 | 语义 | 要不要挂钩 |
| :--- | :--- | :--- |
| `commitStroke(...)` 之后那处 | **真正落盘** | ✅ **唯一需要** |
| 另外四处 | **全是 `onCancel`**（OS 取消手势，注释明确写「半截笔画不写后端」）| ❌ 不该挂 |

而且 `const vib = vibratoStateRef.current` 在提交**之前**就捕获了，所以在清空那行之前读它仍然有效。
⇒ 钩子只落一处，靠上下文里的注释就判定清楚了。

### 发现 2：不需要新建后端通道

原方案的第 3 步是「新增 `setVibratoParams` 编辑通道，跨 Rust」—— 这是最重的一步。
但实际上：**`buildVibratoDense` + `commitStroke` 都在同一个 hook 里**，
浮层拖滑条时**重算密集点再覆盖落盘**就行，**完全复用上游既有路径**。
⇒ 从"跨三层"降级成"hook 内一次 `useEffect` 暴露回调"。

⚠️ 这里踩了一个坑：第一版重算时把 `startValue` / `currentValue` 传了 `0` ⇒
**会把线的走向也改掉**（本来只想改振幅/波长）。修法是加 `lastVibratoRef`
记住最近一条线的**完整**参数（含两端值），浮层回调**只传 amplitude/frequency**。

### 落点（4 个文件）

| 文件 | 改动 |
| :--- | :--- |
| `pianoRoll/VibratoAdjustOverlay.tsx`（新）| 浮层本体：两个 `<input type=range>`（波长/振幅）+ 完成键。锚在**画完那一刻的指针位置**上方（放不下就翻到下方），**不做 frame→px 换算** —— 直接用 `e.clientX/clientY` 最简单，也最贴合「在直线对应位置旁」 |
| `pianoRoll/usePianoRollInteractions.ts` | 加 `onVibratoCommitted` / `onVibratoAdjustReady` 两个 prop；提交后回调；`lastVibratoRef`；暴露"只改波形参数"的闭包 |
| `layout/PianoRollPanel.tsx` | state + 接 prop + `createPortal` 渲染浮层 + **点空白关闭** |
| — | 触屏拖拽一律 `touch-action: none`（项目约定）|

### 「点空白关闭」的区域判定

用户明确要排除「拍数栏 / 钢琴栏 / 上下工具栏 / 菜单栏」。实现是一个捕获阶段的
`document pointerdown`：命中**浮层自身**或**上述四类区域**就放行，其余关闭。
⚠️ 用的是 `data-hs-vibrato-adjust` / `data-hs-ruler` / `data-hs-piano-keys` /
`data-hs-toolbar` / `role=menu|menubar` 这组选择器 ——
**如果上游的这些区域没有对应的 data 标记，判定会退化成"点任何地方都关"**，
需要装机实测确认（至少浮层自身那一条是稳的）。

### 🕳️ 本轮踩的坑：JSX / TS 的「收尾括号」

用脚本往已有代码里插新语句时，**替换起始行不够，闭合的 `)` 必须自己对上**：

- 插入 `useEffect(...)` 到 `useCallback` 的依赖数组后面 ⇒ 把 `useCallback` 原有的
  `);` 顶开了 ⇒ 报 `TS1005 ')' expected`；
- 补了一个 `);`，结果和原本的重复 ⇒ 又报 `TS1128`；
- 最终靠 `sed` 打出前后 20 行、肉眼比对才定位到"多了一个"。

⇒ **教训：脚本插入代码块后，先 `sed -n` 打出插入点前后各 20 行看一眼**，
比连续跑 `tsc` 猜要快。tsc 只会告诉你"哪个位置不对"，不会告诉你"多了还是少了"。

另外还有两处小修：`React.useEffect` 该文件没有 React 默认导入（改成按需 `useEffect`）；
`e as PointerEvent` 的 cast 不合法（React 合成事件自带 `clientX/clientY`，直接读即可）。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉟ 节已追加")
