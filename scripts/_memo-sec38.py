#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：vibrato 模式在手机上的入口（已存在，在 pencil 长按/角标）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊳ 找到了：`vibrato` 在手机上的入口**早就有了**（铅笔长按 / 右下角三角）

之前我一直以为「直线/颤音工具在手机上切不过去」，**这个判断是错的**。
`MobileBottomBar.tsx` 里早就做了：

```
L16-17  绘制按钮右下角有原版同款**小三角**：点三角或长按 = 打开工具子菜单（绘制 / 颤音），
        点本体 = 切到当前绘制工具
L565    /** 绘制工具子菜单（点铅笔右下角三角 / 长按铅笔打开）。 */
L1277   /** 铅笔长按/点角标 → 工具子菜单（原版右键菜单的触屏等价物）。 */
L1286   const currentDrawTool = s.drawToolMode === "line" || s.drawToolMode === "vibrato" ? "vibrato" : "draw";
```

⇒ **所以用户抱怨的「直线/颤音没反应」，跟"切不过去"无关**。
（这是我第二次在"手机上某个功能的入口"上判断错误 —— 上次是 #15 的菜单渲染路径。
**教训照旧：先读真机 DOM / 先读移动端组件，再下结论。**）

### 附带查清的机制

`toolMode` 三值循环：`select` / `draw` / `vibrato`（`sessionSlice` 的 `cycleDragDirection`，
**初值 `"draw"`**）。桌面上靠全局快捷键 `pianoRoll.cycleDragDirection` 循环
（`App.tsx:2773`），手机上靠上面那个铅笔子菜单。

⚠️ 另外 `"line"` 是**旧值**，`currentDrawTool` 里被映射成 `"vibrato"`
（`PianoRollPanel.tsx:931`）—— 所以「直线」和「颤音」上游本就是同一个工具的两种振幅。

### ⏳ 仍未解决

**浮层不弹**。我用 CDP 长按铅笔**没能打开工具子菜单**（合成事件可能不够真实，长按判定没过），
所以**始终没能进入 `vibrato` 模式做端到端验证**。

⇒ 下一步：**加诊断日志**（在 hook 的 vibrato 提交分支里打印
`isVibratoTool` / `vib` / `st.mode`，以及 `onVibratoCommitted` / `onVibratoAdjustReady` 是否被调），
让**用户用真机正常操作一次**，再看 `logs/android.log` —— 这样能一次分清是
「没进 vibrato 模式」还是「钩子没触发」还是「触发了但曲线没重算」。
**别再靠合成事件猜了。**
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊳ 节已追加")
