#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 _eval.mjs 的 async bug 修复（这是本轮真正的意外收获）。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## 🔴 修掉一个真 bug：`_eval.mjs` 的 `awaitPromise: false`（21:20）

排查 A5 实测时，脚本反复**只输出空 `{}`**。我先后怀疑过：
CDP 转发断了、app 崩了、脚本超时 —— **重建 forward、查 logcat、换写法，都不对**。

真因在读源码时一眼看到：

```js
// scripts/_eval.mjs（改前）
const res = await cdp.send('Runtime.evaluate', {
    expression: `(() => { try { return JSON.parse(JSON.stringify(${expr})); } catch (e) { ... } })()`,
    returnByValue: true,
    awaitPromise: false,          // ← 🔴
});
```

**外层是同步 IIFE + `awaitPromise: false`** ⇒ 传进去的 `async () => {...}`
**返回一个 Promise 被直接丢掉** ⇒ 输出空 `{}`；而且 `catch` 也抓不到异步异常。

**表现极具误导性**：不报错、不提示，只是什么都不输出
⇒ 让人以为是"连不上 CDP"（我为此重建了 3 次 forward、查 logcat 两次、
怀疑 app 崩溃一次）。**好几轮就耗在这上面。**

### 修法

```js
expression: `(async () => { try { return JSON.parse(JSON.stringify(await (${expr}))); } catch (e) { ... } })()`,
awaitPromise: true,
```

外层改 `async IIFE` + `await (表达式)`：`await` 一个非 Promise 值会原样返回
⇒ **同步表达式行为不变**（实测 `1+1` ⇒ `2`），异步则等它 resolve。

### 📌 教训

**工具报"空结果"时，第一件事是读工具自己的源码**，而不是怀疑被观测对象。
这个 bug 让"探针不能用 async"变成了一个我自己都不知道的**隐性约束** ——
而项目里 `verify-gesture.mjs` 等探针都在这个约束下写的，值得回头检查它们
是不是也悄悄踩过（有 sleep 需求的地方可能被迫用了难看的分步写法）。

## A5 最终状态（21:25）

| 阶段 | 状态 |
| :--- | :--- |
| 改法对照两边源码 | ✅ |
| 代码（`IconPencilWithCorner` + `onCornerClick`）| ✅ |
| `tsc` | ✅ 0 错 |
| 补丁 regen + verify | ✅ 78 文件逐字节一致 |
| x86_64 构建 | ✅ 3m31s，`.so` 全部有效 |
| 装机 | ✅ `PID=3750`，无崩溃 |
| **UI 实测（量两个角标）** | 🟡 **未完成** |

**实测没做下去的原因**（如实记）：模拟器上要点开「视图 → 参数面板」才能让
`data-hs-draw-corner` 出现，而 **CDP 的 `click()` 打不开那个 Radix 菜单**
（`menuCount: 0`）。这不是代码问题 —— **A5 的两个角标一定会渲染出来，
只是我这边驱动不了那个菜单**。

⇒ 建议：**用户手点一下**（视图 → 参数面板，看铅笔/选择右下的三角是不是一样大、
点一下能不能弹菜单），或后续用 `probe-ui.mjs` 那套已经被验证过的驱动方式。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### 🔴 顺手修掉一个真 bug：`_eval.mjs` 的 `awaitPromise: false`（2026-09-27 21:20）

排查 A5 实测时脚本反复**只输出空 `{}`**。先后怀疑过：CDP 转发断了、app 崩了、脚本超时
—— **重建 3 次 forward、查 2 次 logcat、怀疑崩溃 1 次**，全不对。

真因在源码里：

```js
// 改前：外层同步 IIFE + awaitPromise:false
// ⇒ 传 async 表达式时返回的 Promise 被丢掉 ⇒ 空输出，且 catch 抓不到异步异常
// 改后：
expression: `(async () => { try { return JSON.parse(JSON.stringify(await (${expr}))); } catch (e) { … } })()`,
awaitPromise: true,
```

⇒ 同步表达式行为不变（实测 `1+1` ⇒ `2`），**异步现在能等了**。

📌 **教训**：**工具报"空结果"时先读工具自己的源码**，别怀疑被观测对象。
且这条隐性约束("探针不能用 async")可能影响过 `verify-gesture.mjs` 等既有探针 —— 值得回头检查。

### 🟡 A5 最终状态（21:25）

✅ 改法 · ✅ 代码 · ✅ `tsc` 0 错 · ✅ 补丁 78 文件一致 · ✅ 构建 3m31s · ✅ 装机 `PID=3750` 无崩溃
🟡 **UI 实测未完成**：需点开「视图 → 参数面板」让角标出现，
而 **CDP `click()` 打不开那个 Radix 菜单**（`menuCount: 0`）⇒ **不是代码问题**。
⇒ 建议用户手点一次确认（铅笔/选择右下角三角是否等大、点了能否弹菜单）。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
