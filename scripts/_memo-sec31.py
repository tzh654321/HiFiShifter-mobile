#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #4（全模型随包）+ 更新 TASKS.md。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉛ #4 全模型随包 + 隐藏「模型管理」

用户口径：「目前只制作安装时就带所有模型的版本（或打开时就自动从安装包里提取模型安装），
可以隐藏模型管理设置」。

### 改动小得出乎意料

ADR-012 减包时把 `hnsep.onnx`（92.6 MB）/ `fcpe.onnx`（43.3 MB）从 **bundle 配置**里摘掉了，
**但这两个文件一直在源码树里**（`resources/models/`）。所以"加回来"只是往
`tauri.android.conf.json` 的 `bundle.resources` 补三条：

```json
"resources/models/hnsep/hnsep.onnx"  : "models/hnsep/hnsep.onnx",
"resources/models/hnsep/config.yaml" : "models/hnsep/config.yaml",
"resources/models/fcpe/fcpe.onnx"    : "models/fcpe/fcpe.onnx"
```

**而且不用改 `build-apk.sh §⑤.5`** —— 那段清理逻辑是按 conf **文本 grep** 出「期望目录」
再清 `assets/models/` 的，加回配置后它自动就对。
⇒ 这正是当初把它写成"**从 conf 推导**"而不是硬编码清单的价值：**配置改了，脚本不用跟着改**。

代价：**APK 163 MB → 约 306 MB**（+143 MB）。

### 隐藏「模型管理」—— 又是"两套实现"

入口有两处，**必须都改**：

| 形态 | 文件 | 原入口 |
| :--- | :--- | :--- |
| 桌面 / 平板 | `MenuBar.tsx:1215` | `<DropdownMenuItem>模型管理…` |
| 手机 | `MobileTopBar.tsx:490` | `{ label: "模型管理…", action: … }` |

用 `const HS_MODELS_BUNDLED = true;` 做开关（留个回退余地），两处都改成条件渲染。

⚠️ **这已经是本项目第三次踩"改了一边"的坑**（#15 菜单定位、#13/#14 的菜单、
现在 #4 的入口）。**结论：任何 UI 改动，先确认 phone / tablet / desktop 三条路径
各自渲染哪个组件，再动手。** 已写进 TASKS.md 的技术要点一节。

🕳️ 顺手又踩了两个小坑：
1. 用 Python 做 **JSX 条件包裹**时，光替换起始行不够，**闭合的 `)}` 得自己对上** ——
   第一次漏了，`tsc` 直接报 `')' expected`。
2. 常量插入的判断写成 `if FLAG not in t` —— 而"替换后的文本"里**已经含** `HS_MODELS_BUNDLED`
   （因为它是条件表达式的一部分）⇒ 判断失效、常量没插进去。
   **做两阶段替换时，"是否已存在"的判据要在替换前采集，或者干脆用更精确的锚（如 `const FLAG`）。**
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉛ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 4 |")), None)
if line:
    new = ("| 4 | 模型全内置 + 隐藏模型管理 | ✅ **已完成**（待装机验证）。`hnsep.onnx`(92.6MB)/`fcpe.onnx`(43.3MB) "
           "**一直在源码树里**，只是 ADR-012 减包时从 `bundle.resources` 摘掉了 ⇒ 往 "
           "`tauri.android.conf.json` 补三条即可。**无需改 build-apk.sh §⑤.5**（它是按 conf 文本推导期望目录的）。"
           "APK **163 → 约 306 MB**。模型管理入口**两处**都按 `HS_MODELS_BUNDLED` 隐藏"
           "（`MenuBar.tsx` 桌面/平板 + `MobileTopBar.tsx` 手机）| A | WIP |")
    t = t.replace(line, new, 1)

# 把"三套布局"的教训写进技术要点
anchor = "- 用户偏好：**真机/模拟器实测** > 代码推断；交付要「改了什么 / 根因 / 验证状态」三段式。"
if anchor in t and "三条渲染路径" not in t:
    lesson = (
        "- 🔴 **任何 UI 改动，先确认 phone / tablet / desktop 三条渲染路径各自渲染哪个组件。**\n"
        "  本项目已经**三次**因为「只改了一边」白费功夫：#15 菜单定位（手机上根本不是 Radix 菜单，\n"
        "  是 `MobileTopBar` 自实现的下拉）、#13/#14（同上）、#4 模型管理入口（`MenuBar` + `MobileTopBar` 各一处）。\n"
        "  **做法：先用 CDP 读真机 DOM 的元素 class/属性，确认自己改的文件确实在那条渲染路径上。**\n"
    )
    t = t.replace(anchor, lesson + anchor, 1)

T.write_text(t, encoding="utf-8")
print("✓ TASKS.md：#4 已更新 + 补「三条渲染路径」教训")
