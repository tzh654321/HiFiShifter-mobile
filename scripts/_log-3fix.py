#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #53 / #5 / #52 三项 + #17 已完成的确认。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## 本轮三项（02:40-04:20）

### ✅ #53 滑条数值单位：波长 → 秒，振幅 → ±半音

**先查清楚参数的真实含义**（`buildVibratoDense`，`usePianoRollInteractions.ts:1093`）：

```ts
const wave = amplitude * Math.sin(2 * Math.PI * safeFreq * t);
//                    ↑ 半音（pitch 值域单位）   ↑ t = 归一化 0→1，**不是秒**
```

- **振幅** = pitch 参数值 ⇒ 单位就是**半音**（组件注释也写「振幅的单位就是 [`range`]」）；
- **波长 `frequency`** = 「整条线里放多少个完整波」（注释原话「每个选区内的周期数」），
  范围 `FREQ_MIN=0.2` ~ `FREQ_MAX=12`。

⇒ 要显示「多少秒」必须拿**选区时长**：

```
周期秒 = ((endFrame - startFrame) / 采样率) / freq
```

采样率用项目既有常量 `DEFAULT_PROJECT_SAMPLE_RATE`（48000，
`utils/timelineSnapping.ts`），**没有硬编码**。

**改法**：`slider()` 的末参从 `vertical: boolean` 换成 `format: (v) => string`
（原来那个 bool 只用来选两种显示公式，换成 formatter 后职责直接），
两个滑条各自给格式化；**滑条的 min/max/step 与内部计算一字未动**。

### ✅ #5 文件管理/记事本：删左上角 ✕ + 修好右上角关闭键

**查清的事实**：

| 位置 | 关闭键 | 调什么 | 手机端有效？ |
| :--- | :--- | :--- | :--- |
| `App.tsx` 手机端渲染 | **左上角** `hs-panel-close`（#16 加的）| `toggleMobilePanel(key)` | ✅ |
| `FileBrowserPanel` 右上角 | `IconButton`+`Cross2Icon` | `setVisible(false)` | ❌ |
| `NotebookPanel` 右上角 | 按钮 `t("close")` | `closeNotebook()` | ❌ |

**右上角为什么无效**：#17 把底栏页签改成 redux 勾选项后，手机端的面板显隐看
`session.mobilePanels`，而这两个组件改的是**自己 slice 的 visible**
（那是桌面/平板的权威）⇒ 手机端点上去毫无反应。

**修法**：
1. 删掉左上角两个按钮（用户口径：右上角已有「关闭」，左上角别再放叉）；
2. 右上角两处**保留原 dispatch**（桌面/平板还得靠它），**额外派发**
   `hs-mobile-close-panel` 事件；`App` 监听 → **只在 `isTouchShell` 时**
   `toggleMobilePanel(key)`（桌面端根本不听，零副作用）。

✅ 实测：`.hs-panel-close` 从 **4 个减到 1 个**（默认只开 timeline）。

### ✅ #52 全屏参数界面的 ✕ → 回到全屏轨道界面

`params` 那个 ✕ 原本调 `toggleMobilePanel("params")` —— **只关自己**。
而 `toggleMobilePanel` 有「至少保留一个」守卫 ⇒ **全屏参数时点了完全没反应**
（分屏时倒是正常）。

**改法**：判断「是不是只有 params 一个」：

```
是  ⇒ 关 params **并** `showMobilePanel("timeline")`（= 切到全屏轨道）
不是 ⇒ 按原样只关 params（分屏时仍可单独收起）
```

⚠️ 用 `showMobilePanel`（强制勾上）而非 toggle —— 后者是**翻转**，
万一 timeline 恰好开着就会被它关掉。

### 🔍 顺带确认：**#17 早就做完了**（用户记得没错）

`App.tsx` L509 注释：「C（#17）：底栏页签已删除，四个面板的显隐改为『视图』菜单勾选项（redux）」。
截图 `0098` 确认：视图菜单里是 **✓轨道面板 / 参数面板 / 文件浏览器 / 记事本** 四个勾选项，
**底栏只剩 `∧` / 撤销 / 重做 / 停止 / 播放 / 录制** —— 与用户口径完全一致。
⇒ **#17 无需再动**；上一轮我把它列进"待确认"是多虑了。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ 本轮完成（2026-09-27 02:40-04:20）

| # | 内容 | 结果 |
| :-: | :--- | :--- |
| #53 | 滑条数值单位：波长→秒、振幅→±半音 | ✅ **DONE**。先查清含义：振幅**本来就是半音**（pitch 值域）；波长是「选区内的周期数」（`sin(2π·freq·t)`，t 是归一化进度）⇒ **周期秒 = 选区秒数 / freq**，采样率取项目常量 `DEFAULT_PROJECT_SAMPLE_RATE`(48000)。`slider()` 末参由 `vertical:boolean` 换成 `format:(v)=>string`，**min/max/step 与内部计算未动** |
| #5 | 文件管理/记事本：删左上角 ✕ + 修右上角关闭键 | ✅ **DONE**。**右上角无效的真因**：#17 后手机端面板显隐看 `session.mobilePanels`，而那两处的 ✕ 改的是**自己 slice 的 visible**（桌面/平板权威）⇒ 手机上点了没反应。修法：删左上角 2 个按钮；右上角保留原 dispatch 并**额外派发** `hs-mobile-close-panel`，`App` 只在 `isTouchShell` 时补 `toggleMobilePanel`。✅ 实测 `.hs-panel-close` 4 → 1 |
| #52 | 全屏参数界面 ✕ → 回到全屏轨道 | ✅ **DONE**。原来 `toggleMobilePanel("params")` 有「至少保留一个」守卫 ⇒ **全屏参数时点了没反应**。改：只有 params 时 ⇒ 关它 **并** `showMobilePanel("timeline")`；分屏时行为不变。⚠️ 用 `showMobilePanel`（强制勾上）而非 toggle（翻转会误关） |
| #17 | 删底栏页签 | ✅ **确认早已完成**（用户记得没错）。`App.tsx` L509 注释 + 截图 `0098` 双重确认：视图菜单里是四个勾选项，底栏只剩 `∧`/撤销/重做/停止/播放/录制 |

**其余待做**：轨道菜单对齐长按轨道头（#49）· #10 电脑版操作方法（#51）· #9 关联文件送进导入流程 · #11 剪贴板粘贴到其他应用
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
