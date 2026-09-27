#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㊸ 节：第 6 轮首批 4 项完成。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊸ 第 6 轮首批 4 项完成（D3 / B1 / B2 / D2）

| # | 需求 | 根因 / 做法 |
| :--- | :--- | :--- |
| **D3** | 选区后点拍数栏改不了进度条 | 根因**与选区无关**：`onRulerMouseDown` 首行调 `isLegacyMouseEventFromStylus()`，而它在 `penInput.ts:209` 对 **touch 也返回 true** ⇒ 触摸下整条 seek 被掐掉；参数编辑器又没有时间线那套 pointer 路径。改为只拦 `pen` + 双指让位。**模拟器实测通过**（点后红线移动、气泡读数 `1.1.099 / 0:0.049`）|
| **B1** | 气声音量左侧图标 = 右侧开关图标（除颜色）| `ParamToolbarPill` 加 `leadingIcon` prop，`breath_gain` 传 `BreathAirIcon`；`BreathAirIcon` 本就 export（注释写明「手机端 👁 菜单也用这一个图形」），符合"同一图形只画一份" |
| **B2** | V 菜单 `↘MID` 换真图标 + 比例对齐 | 它原本是**文字 Button**：宽 **43px**（旁边「参考轨道组」92px，其它工具都是正方形 `IconButton`）⇒ "导入 MIDI" 被压成两行，看着就像「↘MID」。改为 `IconButton` + 复用 `FileBrowserPanel` 的 `MidiIcon`（已 export）|
| **D2** | 笔菜单加「还原」工具 | `DrawToolMode` 加 `"restore"`；落笔改为 `toolMode === "restore" OR secondaryDown ? "restore" : "draw"` —— **与电脑右键走同一条服务端路径，不新开分支**；`DrawToolMenu` 加一行；新画 `IconRestoreTool`；i18n zh/en 补 `mobile_tool_restore` |

### 🕳️ 验证手段的边界（第三次撞上，值得记死）

**长按 / 多指这类手势，CDP 的合成 pointer 序列重现不了** ——
长按判定依赖真实按住时长与静默期，合成事件过不去。三次实例：

1. #7 那轮：长按铅笔开不出工具子菜单；
2. #7 那轮：真机 CDP 根本连不上（ColorOS 限制）；
3. 本轮：同样开不出。

⇒ **结论**：这类"需要真实手势"的验证**只能交给用户手点**。
AI 能负责的边界是：**代码正确 + tsc 干净 + 构建装机通过 + 非手势路径实测**。
**别在合成手势上反复撞** —— 每次一两轮、收益为零。

### 🕳️ 反引号第 9 次

又用 `python -c "...反引号..."` 写 memory ⇒ bash 把反引号当命令替换、内容全被吞。
**这次没造成破损**（脚本在写入前就报错了），但必须彻底改掉：
**只要内容含反引号 / `$` / `!` / 双引号，一律 Write 成 `.py` 文件再跑。**
"""
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊸ 节已追加")
