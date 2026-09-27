#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #7 UI 修正 + 日志通道的两次失败与最终解。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㊵ #7 UI 三修 + 终于找到能落盘的日志通道

用户反馈（真机实测后）：
> 表现与前两次测试一致；滑条的颜色要为主题色（并检查其它你修改的没遵循主题色的地方）；滑条右边的数字出界了。

### UI 问题 1+3：**没用项目主题变量 + 面板太窄**

- **颜色**：我用了 HTML 原生 `<input type=range>` 的 `accentColor: var(--accent-9)`
  —— 这只能染原生部分样式，**跟不上项目主题**。
  而 `index.css` **L428-465 早就定义了 `.qt-range`**：track 用 `--qt-border`、
  thumb 用 `--accent-9`，参数编辑器「平滑度」等滑杆全用它。
  ⇒ 改成 `className="qt-range"`，去掉 `accentColor`。
- **数字出界**：面板 196px 装不下「标签 26 + 滑条 128 + 数值 34 + 间隙」。
  ⇒ 面板加宽到 **232px**、数值列 **40px**，并给数值加 `fontVariantNumeric: tabular-nums`
  （拖动时数字宽度不跳）。
- **顺带**：「完成」键从"透明底+边框"改成 `background: var(--accent-9)` + `--accent-contrast`，
  和滑条 thumb 同一套变量。

**自查我改过的其它 UI**：`FileBrowserPanel` 的授权按钮用的是 Radix `<Button variant="soft">`（走主题 ✓）；
`MenuBar`/`MobileTopBar` 的菜单定位、`ExportAudioDialog` 的 `minWidth`、`PianoRollPanel` 的 portal
—— **全是纯几何改动，无颜色**。⇒ 只有这个新浮层有主题色问题。

### 🕳️ 日志通道：踩了两次坑才找到对的路

| 版本 | 写法 | 真机结果 |
| :--- | :--- | :--- |
| v1 | `console.warn('[HS-VIB] …')` | **日志里没有** |
| v2 | `console.error('[HS-VIB] …')` | **日志里还是没有** |
| v3 | `invoke("log_frontend_error", { message })` | ✅ 通道验证可用 |

**结论**：上游只转发 **uncaught 异常**（`window.onerror` / unhandledrejection），
**普通的 `console.warn` / `console.error` 调用都不会**进 `logs/android.log`。
要写诊断日志必须**直接 invoke 后端命令** —— `commands/diagnostics.rs:196` 的
`log_frontend_error(message, detail)`（已在 `lib.rs:737` 注册，前端映射表 `services/invoke.ts:711`）。

⚠️ 顺带踩的：这个 `invoke` 的模块路径是 **`services/invoke`**（不是 `services/api/invoke`）——
`services/api/fileBrowser.ts` 里写的是相对路径 `../invoke`，容易看错。
而且用脚本替换 `"../../services/api/invoke"` 时会**连前缀一起匹配**，
结果多叠了一层变成 `../../../../`，被 `tsc` 拦住。**改相对导入要整行替换，别只换子串。**

### ⏳ 仍未解决

**「拖滑条 ⇒ 曲线不变」**。用户反馈"与前两次测试一致"。现在日志通道通了，
**下一次操作就能从 `[HS-VIB]` 系列日志看清断点**：
`adjustReady effect run hasCb=?` → `slider amp=? hasLast=?` →
`flush frames=? amp=? freq=?` → `OK committed` / `X commit failed` / `X lastVibratoRef empty`。
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊵ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 7 |")), None)
if line:
    t = t.replace(line,
        "| 7 | 直线/颤音画完显示横纵两个滑动条（横=波长，纵=振幅），点空白确认关闭 | "
        "🟡 **浮层已实测可用**（用户真机截图确认：双滑条 + 完成键正常弹出，滑条读数也会变），"
        "**但拖滑条后曲线不重算**。已修：① 振幅初值 0 导致「还是直线」 ⇒ 拖波长自动补默认值；"
        "② `onChange` 每次落盘 ⇒ 改节流；③ `AMP_MAX` 写死 1200 ⇒ 按 `currentParamRange` 算。"
        "**UI 三修（用户反馈）**：滑条改用项目的 `.qt-range`（主题色 `--accent-9`，原先用原生 `accentColor` 跟不上主题）；"
        "面板 196→**232px** + 数值列 40px + `tabular-nums`（原先数值出界）；完成键改主题强调色。"
        "**日志通道**：`console.warn`/`console.error` **都不会**落盘（上游只转发 uncaught 异常）⇒ "
        "改用 invoke 调 `log_frontend_error`（通道已冒烟验证）。"
        "⏳ **请再操作一次**：开 Compose → 铅笔三角切颤音 → 画线 → 拖滑条 → 点完成，然后读日志定位断点 | A | WIP:等日志 |", 1)
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md #7 已更新")
