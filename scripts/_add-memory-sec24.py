#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 memory ㉔ 节：用户第 6 轮清单（17 项）的第一批交付。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㉔ 用户第 6 轮清单（17 项）+ 「与另一个对话协作」的落地方式

### 先说协作方式

用户说「目前有另一个对话在此项目工作，你可以与它交流并分配任务」。
**我没有跨对话的直接通信通道** —— 于是用**共享文件**做板子：项目根新建 **`TASKS.md`**，
里面写清「环境现状 / 已交付 / 本轮 17 项（含 Owner 与状态）/ 技术要点」，
约定**改状态只动自己那几行**。这是能达成的等价方案，也顺手把踩过的坑集中留档。

### 已交付（本批 4.5 项）

| # | 事项 | 关键点 |
| :-: | :--- | :--- |
| 1 | 图标换成与电脑版一致 | 源图用**上游** `icons/icon.png`（512×512，就是桌面版那张）。生成 15 个 PNG（5 密度 × 方形/圆形/前景）+ **补 `mipmap-anydpi-v26` 自适应入口**（上游模板只有 PNG，没这个目录 ⇒ 前景层根本不会被用到）；背景色 `#17242C` 取自图标自身。脚本 `_gen-android-icons.py` / `_gen-adaptive-icon-xml.py` |
| 2 | 👁 菜单每项图标要不同 | 原先只有 `pitch` 用 `IconPitchSnap`、**其余一律 `IconDragAxis`**。自绘 5 个（formant/tension/volume/pan/generic），风格对齐 `18×18` + `viewBox 16×16` + `currentColor`；气声复用上游 `BreathAirIcon`。`IconDragAxis` 随之无用，已删（否则 tsc 报未使用）|
| 3 | 👁 菜单去掉「切换到」 | 把「图标 + 文字」整体包成一个 `button`（`aria-pressed` 保留切换语义）；右侧只剩气声开关 + 曲线显隐 |
| 12 | 快捷键提示开关（默认关） | 🔑 **`shortcutLabel()` 是唯一的渲染入口**（25 处调用都走它）⇒ 只在定义处加一行 `if (!s.showShortcutHints) return ""` 就全覆盖，不用改那 25 处。链路：`config.rs`（`#[serde(default)]`，对 bool 正好=false ⇒ 默认关且老配置兼容）→ `runtimeThunks`（存）→ `sessionSlice`（类型/默认/reducer/恢复/导出）→ `UiSettings`（**前端是另一套类型，要单独加**）→ MenuBar 的 **selector 字面量**（`s` 是手工挑字段的，不是整个 session）→ 视图菜单勾选项 → i18n ×5 |
| 15 | 菜单别靠左 | **模拟器实测确认**：「视图」在 x≈142，菜单却从 x≈10 起。根因是 **Radix 的碰撞重定位** —— 菜单约 320px 宽，从母菜单位置起算会右溢出（142+320 > 360 视口），Popper 就把面板整体左推。⇒ CSS 限宽 `calc(100vw - 20px)` + 20 处 `collisionPadding={4}` |

### 两个需要用户澄清的（已在 TASKS.md 标注）

- **#14 菜单去除 `>` 符号**：我在模拟器上打开视图菜单，**只看到右侧 Radix 自带的 `›`**
  （`主题: 深色 ›`、`语言 ›`），**没有多余的 `>` 字符**。需要用户指明是哪个菜单的哪一项，
  或给张截图。
- **#13 视图菜单最下面那条分隔线上移一行**：视图菜单里**有 4 条分隔线**，
  最下面那条在「主题」与「外观设置」之间。需要澄清"上移一行"是指删掉上方空行，还是别的。

### 「动态」的结论（#16）

- 基线 `7f0a4105` **= 上游 develop HEAD**（`compare` → `identical`）
- `main` 分支与基线 `diverged`，但**我们领先它 381 个提交**，它只多 1 个 merge commit
  ⇒ **`main` 是旧稳定分支**，**不存在"功能没同步进来"**
- `zh-CN.ts` 里搜「动」只有「自动 / 抖动 / 自动备份」等，**没有叫「动态」的功能**
- 桌面版主程序 `HiFiShifter.exe` 里「动态」只出现 **1 次**，且上下文是字体/字典数据
  （「…窗口动态状态特别认为必须…」）⇒ **不是功能名**

⇒ 结论：**上游没有「动态」这个功能名**，需要用户说明它长什么样 / 在哪个菜单。

### 环境

- 真机 `221deeb` 离线 ⇒ 改用**模拟器**（`hs-phone-tall`，1080×2400@480 = 360×731 CSS）
- 🕳️ **菜单截图要用 CDP**：`adb shell input tap` **点不开 Radix 菜单**（它监听 pointer 事件），
  得用 CDP 派发 `pointerdown`/`pointerup`/`click` 三连
- CDP 端口默认 **9222**（`touch-drive.mjs --port`）
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉔ 节已追加")
