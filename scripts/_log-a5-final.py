#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 A5 的最终状态（代码+构建完成，装机实测因环境受阻未完成）。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## 🟡 A5 最终状态：代码 + 构建 ✅，**装机实测未完成**（21:15）

### 已完成

1. **改法确定**（对照两边源码）：绘制向选择看齐（命中区 6→14、`-1`→`-4`、
   opacity 0.7→0.9、加 `cursor:pointer`、新增 `onCornerClick` 点角标开菜单）。
2. **代码已改** `MobileBottomBar.tsx` 的 `IconPencilWithCorner` + 调用点传 `openDrawMenu`。
3. `tsc` 0 错 · 补丁 regen + verify 通过（78 文件逐字节一致）。
4. **x86_64 包构建成功**（3m31s，`.so` 全部有效）· **已装进模拟器**（`PID=3750`，无崩溃）。

### 未完成：装机后的**实测**

卡在环境上，不是代码问题：

- **第一次构建失败** ⇒ C 盘满（只剩 649M）。
- 清空间要**关模拟器**（`ram.img` 2.5GB 正被占用）⇒ 关掉后 `df` 才涨。
- **关掉后就起不来了**：连试两次都停在 `Found systemPath`（模拟器要写快照，
  C 盘余量不足）。第三次清到 3.1G 才起来（`Boot completed in 23976 ms`）。
- 装机成功、app 正常跑，但**CDP 求值不稳**：第一次返回空、重建 forward 后能通
  （`hasInvoke:true, vw:360`），带 `sleep` 的稍复杂脚本又超时返回空。

⇒ **没测到的就如实标「未验证」**：两个角标是否都是 14×14、点角标是否真能开菜单。

### ⚠️ 教训（写进 MEMORY.md 硬约定 #12 了）

Gradle 失败时**先 `df /c`**。这已经是**第三次**因为 C 盘满而先去看代码了。

⚠️ 另一个教训：**`ram.img` 是「用完即弃」的资源** —— 为了它关模拟器，
结果模拟器反而起不来，绕了一大圈。**该在构建前就清它，而不是构建失败后。**
（构建**不需要**模拟器在跑；只有装机/探针才需要。）
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### 🟡 A5 进展（2026-09-27 21:15）

**已完成**：改法对照两边源码确定 ⇒ 绘制向选择看齐（命中区 **6→14**、`-1`→`-4`、
opacity **0.7→0.9**、加 `cursor:pointer`、**新增点角标开菜单** `onCornerClick`）；
`tsc` 0 错；补丁 78 文件逐字节一致；**x86_64 包构建成功并装进模拟器**（`PID=3750`）。

**未完成**：装机后的实测（量两个角标、点角标开菜单）——
**卡在环境**：第一次构建因 **C 盘满**失败（只剩 649M）⇒ 清空间需先关模拟器（`ram.img` 2.5G 被占用）
⇒ 关掉后模拟器**起不来**（两次停在 `Found systemPath`，余量不足）⇒ 第三次清到 3.1G 才起来
⇒ 装机 OK、CDP 时通时不通。

⚠️ **教训**（已升级为 MEMORY.md 硬约定 **#12**）：
**Gradle 失败先 `df /c`，不要先看代码** —— 这是**第三次**踩。
另：清 `ram.img` **该在构建前做**（构建不需要模拟器），别等构建失败了才绕。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
