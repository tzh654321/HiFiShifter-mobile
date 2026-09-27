#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把第 6 轮需求的完成进度写进 TASKS.md。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

STATUS = """

### ✅ 第 6 轮进度（2026-09-25 上午）

| # | 需求 | 状态 |
| :-- | :--- | :--- |
| **D3** | 选区后点拍数栏改不了进度条 | ✅ **已修 + 模拟器实测通过**。根因：`onRulerMouseDown` 首行 `isLegacyMouseEventFromStylus()` 对 **touch 也返回 true**（`penInput.ts:209`），参数编辑器又没有时间线那套 pointer 路径 ⇒ 触摸下整条 seek 路径被掐掉。**与选区无关**。改为只拦 `pen` + 双指让位。实测：点拍数栏后播放红线移动、时间气泡显示 `1.1.099 0:0.049` |
| **B1** | 气声音量左侧图标 = 右侧开关图标（除颜色）| ✅ `ParamToolbarPill` 加 `leadingIcon`，`breath_gain` 传 `<BreathAirIcon />`；加了 `.param-pill__leading-icon` 样式 |
| **B2** | V 菜单 `↘MID` 换真图标 + 比例一致 | ✅ 根因：它是**文字 `Button`**，宽 43px 装不下「导入 MIDI」被压成两行（看着像 ↘MID），而旁边全是正方形 `IconButton`。改为 `IconButton` + 复用 `FileBrowserPanel` 的 `MidiIcon`（已 export，避免两处各画一份）|
| **D2** | 笔菜单加「还原」工具 | ✅ `DrawToolMode` 加 `"restore"`；落笔时 `toolMode === "restore" \|\| secondaryDown ? "restore" : "draw"`（**与右键走同一条服务端路径，不新开分支**）；`DrawToolMenu` 加一行 + `IconRestoreTool` 图标；i18n zh/en 各加 `mobile_tool_restore` |

**待做**（按难度排序的建议顺序）：

| # | 需求 | 备注 |
| :-- | :--- | :--- |
| D5 | 钢琴栏缩放卡边界 | 需交互调试（双指顶到边界时的基准回写）|
| B3 | 软件图标有点糊 | 需要高分辨率源图重新生成 mipmap |
| D4 | 选择工具加三角 + 「拖动」工具（手套）| 新工具 + 手势语义 |
| D1 | 上工具栏加 复制/剪切/粘贴 + 上移/下移 | 「上移/下移」逻辑深嵌 `App.tsx` 的全局快捷键处理（依赖 `store`/`resolveParamShiftIntent`），需先提取 |
| B4 | 文件浏览器长按音频拖到轨道窗 | 跨面板拖放 |
| C | **删底栏**（→ 勾选项进「视图」菜单）| 大工程，规格已明确（模仿 flm）|
"""

anchor = "### E. 交互规格（参照 flm，附件表格）"
assert anchor in t, "找不到 E 组锚点"
t = t.replace(anchor, STATUS.strip() + "\n\n" + anchor, 1)
P.write_text(t, encoding="utf-8")
print("✓ TASKS.md：第 6 轮进度已写入（4 项完成 / 6 项待做）")
