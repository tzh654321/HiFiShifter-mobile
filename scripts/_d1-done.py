#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 完成记录。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊻ D1 完成：上工具栏右对齐加 复制/剪切/粘贴 + 上移/下移

### 🎉 好消息：五个能力**全都已存在**，不需要写任何业务逻辑

`PianoRollPanel` 有个统一分发器 `handleEditOp(op, data)`（L5154），switch 里已有：

```
case "copy"                   ← L5405
case "cut"                    ← L5446
case "paste"                  ← L5501
case "shiftParamUpSelection"  ← L5695
case "shiftParamDownSelection"
```

而右键菜单（L7693-7698）用同一批 op：`onCopy={() => void handleEditOp("copy")}`。
⇒ 只需加按钮调用它 —— **长按重复、在途守卫（`beginSelectionParamEdit`）等机制全部自动继承**。

### 🕳️ 踩了两个坑

**坑 1：按"缩进"找插入点会命中内层容器。**

我搜"缩进 20 的 `</Flex>`"作为 `hs-param-toolbar` 的结束，结果命中了一个**内层**容器 ⇒
5 个按钮变成那个容器的最后一个子元素 ⇒ 手机上是 `overflow-x: auto` ⇒ **被推到屏幕外，
CDP 能查到按钮存在、`aria-label` 也对，但截图里什么都没有**。

⇒ 教训：**在超长 JSX 里定位插入点，别只按缩进猜** ——
要**从开标签往后扫描、按同缩进配对**，并**打出所有顶层子元素**核对
（这次打印后一眼就看出 "子元素 6937 / 7237 / 7283 / 7284" 里有异常的两个连续 `</Flex>`）。

**坑 2：手机上 `.hs-param-toolbar` 是 `display: none`。**

`index.css` 里手机端改用自绘的 `MobileParamToolRow`（`.hs-param-toolbar` 整个隐藏）。
⇒ 桌面工具栏加完按钮，手机上全不可见（`getBoundingClientRect()` 全 0）。

⇒ 解法：底栏与参数面板是**两棵组件树**，用 `window.__hsEditOp` 桥接
（`PianoRollPanel` 挂、`MobileParamToolRow` 调）。⚠️ 只是过渡方案，op 多了应改 Context。

**坑 3（第二次犯）**：用脚本往 import 块 append 时**多留了一个逗号** ⇒ `StopIcon,, CopyIcon`。
⇒ **改 import 要整块替换，不要"在原串尾部拼"，原串可能已带尾逗号。**

### ✅ 实测（模拟器 CDP 全部通过）

手机工具栏 9 个按钮，宽 40、位置连续：

```
选择(2) 绘制(44) 参数与覆盖层(86) 复制(128) 剪切(170)
粘贴(212) 上移(254) 下移(296) 参数菜单(338)
```

`hasBridge: true`（window 桥接通）✓，截图确认五个图标一行排布、清晰可见 ✓
""", encoding="utf-8")
print("✓ memory ㊻ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| D1 |")), None)
assert old, "找不到 D1 行"
t = t.replace(old,
    "| **D1** | 上工具栏右对齐加 复制/剪切/粘贴 + 上移/下移 | ✅ **已完成 + 实测通过**。"
    "五个 op 在 `handleEditOp` 里**全都已存在**（右键菜单同款），只需接按钮 —— 长按重复/在途守卫自动继承。"
    "① 桌面 `.hs-param-toolbar` 末尾加右对齐组（`marginLeft:auto`）；"
    "② ⚠️ 手机端 `.hs-param-toolbar` 是 `display:none`（改用自绘 `MobileParamToolRow`），"
    "故用 `window.__hsEditOp` 桥接，在手机工具栏也加了一组；"
    "③ 自绘剪刀图标（Radix 无）、补齐图标 import；④ tooltip 复用已有 i18n key "
    "`kb_pianoroll_shift_param_up/down_selection`。**实测**：手机 9 个按钮一行排布、位置连续、`hasBridge:true` ✅ |",
    1)
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md：D1 标记完成")
