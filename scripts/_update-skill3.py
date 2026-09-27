#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补两条硬教训进 skill（两条 UI 路径 / 日志管道不通时的诊断）。"""
from pathlib import Path

S = Path(r"C:\Users\tzh\.workbuddy\skills\tauri2-android-bringup\SKILL.md")

ADD = """

### 7. 🔴 同一条数据有**两条 UI 更新路径**时，去看"能工作的那条"用的哪个接口

**实例（#7 颤音滑条，卡了 4 轮）**：现象是「滑条读数会变、后端 `commitStroke` 返回成功（成功点数恒定 213）、
**但曲线纹丝不动**」。

根因：`commitStroke` 内部靠 `applyToParamViewDense → setParamView` 刷新前端，而那里开头是
`if (!pv) return;` —— **没有 live-edit base 时静默跳过 UI 更新**，但**后面的后端 IPC 照常执行** ⇒
「报成功、没变化」。

我第一轮只在旁边补了 `ensureLiveEditBase(pv)` —— **没用**。
第二轮**照抄绘制路径**才成：`ensureLiveEditBase` → **`applyDenseToLiveEdit`（写 live 预览层）**
→ **`invalidate()`** → 最后才 `commitStroke` 落盘。

⇒ **判据**：当"我这条路径不刷新 UI、但另一条（绘制/拖动预览）能刷新"时，
**先去读那条能工作的路径调了哪些接口**，然后照抄 —— 比在坏路径上加参数快得多。

### 8. 日志管道不通时，把状态**渲染到界面上**

写诊断日志在这个项目里连踩三次：

| 写法 | 真机结果 |
| :--- | :--- |
| `console.warn` | 不落盘 |
| `console.error` | 不落盘（上游只转发 **uncaught 异常**）|
| `invoke("log_frontend_error")` | 打点压根没跑到（日志仍为空）|
| ✅ **把 `ref/last/N` 直接画在浮层上** | **一张截图就定位了** |

⇒ **结论**：当"日志不可靠"时，优先选**用户/我截个图就能看到**的可视化诊断。
这个项目每一步本来就要截图验证，**把调试状态画进界面几乎零成本**，比修日志通道快得多。

### 9. 🕳️ 「点框外关闭」类浮层的判定，必须排除**所有可交互控件**

#7 第一版只按"区域"排除（拍数栏/钢琴栏/工具栏/菜单栏），结果**用户一点播放就关掉了浮层**
（而调曲线恰恰要边听边调）。

⇒ 判定里加上 `button` / `[role="button"]` / `input` / `select` / `[role="slider"]`，
**任何可交互控件都不算"空白"**。
另外这类浮层**底色要透明**，否则挡住波形，用户没法边看边调。
"""

t = S.read_text(encoding="utf-8")
if "同一条数据有" in t:
    print("· 已存在")
else:
    S.write_text(t.rstrip("\n") + ADD, encoding="utf-8")
    print("✓ skill 已追加 3 条（两条 UI 路径 / 界面化诊断 / 浮层判定）")
print(f"  现在共 {len(S.read_text(encoding='utf-8').splitlines())} 行")
