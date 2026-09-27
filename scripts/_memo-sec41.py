#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #7「曲线不变」的定位结论。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊶ #7「拖滑条曲线不变」——**定位到根因了**

用户第三次反馈后，我做了两件事：① 把调试状态**渲染到浮层上**（绕开日志），
② 真机自己用 `adb shell input` 复现了一遍。**两轮截图对比直接锁定了断点。**

### 证据（真机 221deeb，同一浮层拖前/拖后）

| 项 | 拖前 | 拖后 | 结论 |
| :--- | ---: | ---: | :--- |
| 波长读数 | 5.70 | **5.15** | ✅ `onChange` 被调到了 |
| 振幅读数 | 26 | **29** | ✅ 同上 |
| 浮层 diag | `committed N=208` | `committed N=208` | ✅ **`commitStroke` 执行了且没抛错** |
| **曲线** | 斜线 | **斜线** | ❌ **没变** |

⇒ **不是"没触发"，是"触发了、也报成功，但 UI 没更新"。**

### 根因：`commitStroke` 里有个静默短路

`pianoRoll/useLiveParamEditing.ts` L113-139：

```ts
const pv = paramView;
function applyToParamViewDense(denseStartFrame: number, dense: number[] | null) {
    if (!pv) return;                    // ← 静默跳过：不改 UI
    if (pv.stride <= 0) return;         // ← 同上
    ...
    setParamView({ ...pv, edit: nextEdit });   // ← 曲线靠这一行刷新
}
```

**后端 IPC（`paramsApi.setParamFrames`）在后面照常执行** ⇒ 所以日志/返回都是成功的，
但**前端的 `paramView.edit` 没被更新** ⇒ **曲线纹丝不动**。
两处静默 `return` 正是"报成功却没变化"的来源。

⚠️ 对比：**画线时能看到变化**，是因为绘制路径走的是 `applyDenseToLiveEdit` →
`liveEditOverrideRef`（**live 预览层**），不依赖 `paramView`。
**两条路径的 UI 更新机制不同** —— 这是我一直没意识到的地方。

### 下一步修法（明确）

在 hook 的 `flush()` 里，**先建立 live-edit 会话再提交**：
调 `ensureLiveEditBase(paramViewRef.current)`（`PianoRollPanel.tsx:3855` 已把它从
`useLiveParamEditing` 解构出来，hook 的 props 里就有），再走 `commitStroke`。
或者更直接：在 flush 里**显式把新 dense 应用到 `paramView`** 并 `invalidate()`。

⚠️ 定完位记得**删掉那行 diag 显示**（`VibratoAdjustOverlay` 的 `diag` prop +
`PianoRollPanel` 的 `vibratoDiag` state + hook 的 `onVibratoDiag`）。

### 🕳️ 方法论收获（比这次修复更值钱）

**日志走不通时，把状态渲染到界面上。** 我在这上面绕了很久：

1. `console.warn` ⇒ 不落盘；
2. `console.error` ⇒ 还是不落盘（上游只转发 uncaught 异常）；
3. `invoke("log_frontend_error")` ⇒ **打点压根没跑到**（日志为空）；
4. ✅ **把 `ref/last/flush` 状态直接画在浮层上** ⇒ **一张截图就定位了**。

⇒ 遇到"日志管道不可靠"的场景，**优先选"用户/我截图就能看到"的可视化诊断**，
比修日志通道快得多。这个项目尤其适合 —— 反正每一步都要截图验证。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊶ 节已追加")
