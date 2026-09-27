#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #46/#42 及 vite 清目录被拦的坑。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## 本轮（21:00-22:20）

### ✅ #46 参数钢琴条缩放"触碰边缘卡住"

**根因**：`PianoRollPanel` 的双指只挂在两块窄边上：

```ts
offs.push(controller.attachSurface(axisEl, "y"), controller.attachSurface(rulerEl, "x"));
//   axisEl = 左侧音高轴（43px）   rulerEl = 顶部拍数栏（47px）
```

**主体（滚动容器）没挂** ⇒ 手指落在主体上时双指**不进入会话**
⇒ 想缩放必须把手指凑到那两条窄边上，**一滑出去就会话中断 = "卡住"**。
用户明确「**不要求触点贴合图形**」⇒ 主体整片都该能缩放。

**修法**：给 `scrollerRef` 也挂 `attachSurface(bodyEl, "both")`。

⚠️ **安全前提**（查过代码才敢做）：`attachSurface` **只绑事件、不改 `touch-action`**
（改它的只有 `attach()`，且只对主容器）⇒ 不会禁掉原生的单指纵向滚动。

### ⚠️ #42 "轨道"菜单靠右 —— **改了但没解决**

**根因（已找到）**：

```ts
// 原代码
setMenuAlign(left + 460 > window.innerWidth ? "end" : "start");
// 注释：用内容自然宽度粗估（最宽的「视图」菜单约 460px），宁可估大
```

`460` 是**桌面**的估计，而**手机屏宽只有 360** ⇒ `left + 460 > 360` **恒成立**
⇒ 手机上市面上每个菜单都靠右，与"放不放得下"无关。

**两次尝试都失败**：
1. 改成 `min(460, innerWidth * 0.75)`（手机 270）⇒ 仍 end；
2. 改 `min(460, innerWidth * 0.5)`（手机 180）⇒ 仍 end；
3. 固定 `align="start"` + **给 6 处 `Content` 加 `avoidCollisions={false}`** ⇒ **仍 end**
   （实测 `menuLeft=188`、`winW=360`，右贴边）。

⇒ 说明 **`@radix-ui/themes` 的 `DropdownMenu.Content` 可能不透传 `avoidCollisions`**，
或者还有第三层机制在翻转。**下一步该直接查 `@radix-ui/themes` 的 Content 实现**，
而不是继续调判据（已经证明判据不是原因）。

⚠️ 另：我量 `triggerLeft` 时按"文字 === '轨道'"取到了第一个匹配，
实际量到的是「编辑」（96），真实"轨道"在 ~150 —— **量错元素**，
但即便如此 `150+180=330 < 360` 仍应 start ⇒ **判据确实不是原因**。

### 🕳️ 新坑：vite 清 `dist` 被 safe-delete 拦 ⇒ **前端构建整体挂掉**

```
[vite:prepare-out-dir] [safe-delete] 操作失败: ERROR ...\\frontend\\dist\\appearance.html:
  Error during a `trash` operation: Unknown { description: "Some operations were aborted" }
```

⇒ tauri 报 `beforeBuildCommand ... failed with exit code 1`，
**看着像代码错，其实与代码无关**（我又误判了一轮）。

**绕过**：`vite.config.ts` 里 `build.emptyOutDir: false`
（产物带 content hash，旧文件不会被引用）。

⚠️ 这与 memory 里那条"批量删除会被拦"是**同一个根因**，
只是这次撞在 **vite 的构建流程**里 —— 凡是要"清目录"的构建工具都可能踩。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
if "#46" not in t:
    t = t.rstrip() + """

### 本轮（21:00-22:20）

| 条目 | 状态 |
| :--- | :--- |
| **#46 钢琴条缩放触边缘卡住** | ✅ **已修**。根因：双指只挂在**音高轴(43px)和拍数栏(47px)两条窄边**上，**主体没挂** ⇒ 手指一滑出窄边会话就断 = "卡住"。⇒ 给 `scrollerRef` 也挂 `attachSurface(..., "both")`。⚠️ 先查过 `attachSurface` **只绑事件、不改 touch-action** ⇒ 不影响原生滚动 |
| **#42 "轨道"菜单靠右** | ⚠️ **根因已找到、改法未生效**。原判据 `left + 460 > innerWidth`（460 是**桌面**估计，手机屏宽才 360 ⇒ **恒成立**）。试了 3 种改法（0.75×宽 / 0.5×宽 / 固定 `align="start"` + `avoidCollisions={false}`）**仍 end**。⇒ **下一步直接查 `@radix-ui/themes` 的 Content 实现**，别再调判据 |

### 🕳️ 新坑：vite 清 `dist` 被 safe-delete 拦

```
[vite:prepare-out-dir] [safe-delete] Error during a `trash` operation
  → tauri 报 beforeBuildCommand exit 1（看着像代码错，实际无关）
```

**绕过**：`vite.config.ts` → `build.emptyOutDir: false`。
⚠️ 与「批量删除被拦」同一根因，只是撞进了**构建流程**里。
"""
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md 已更新")
