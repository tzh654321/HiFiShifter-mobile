#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #7 真根因 + bypass 脚本 bug + 用户新提的 6 条。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #7 真根因（02:00-02:44）—— **cleanup 把进行中的节流 timer 清掉了**

### 现象

拖动滑条时曲线不动，**松手才更新一次**。其余正常。

### 调用链

```
<input type=range onChange>     → onChangeValue(v, /*commit*/ false)   拖动中
<input type=range onPointerUp>  → onChangeValue(v, /*commit*/ true)    松手
        ↓
onVibratoAdjustReady({ amplitude, frequency, commit })
        ↓
  pending.value = {...}
  if (commit) { flush(); return; }         // 松手：立即 flush ⇒ 曲线更新 ✅
  if (timer.value) return;                 // 已有 timer ⇒ 返回（正确的节流）
  timer.value = setTimeout(flush, 60);     // 否则起 60ms timer
```

### 根因

注册 `onVibratoAdjustReady` 的那个 `useEffect` **依赖数组里有 `currentParamRange`**，
而它**拖动过程中会变** ⇒ **effect 重跑** ⇒ React 先跑上一轮 cleanup：

```ts
return () => {
    if (timer.value) { clearTimeout(timer.value); timer.value = null; }   // ← 凶器
};
```

⇒ 刚起好的 60ms timer **被清掉** ⇒ `flush` 永不执行
⇒ **唯一能更新曲线的路径只剩松手时的 `commit: true`**。

⚠️ **上一轮的注释写着「改成 useRef 就不会被清了」—— 这是误判**：
`useRef` 只让变量跨 effect 存活，**cleanup 照样能清掉它指向的 timer**，
而且 timer 是**共享**的，effect 重跑时更容易误伤正在等待的那一个。

### 修法

**定时器生命周期与那个 effect 解耦**：
- 注册 effect 只负责注册回调（依赖该变的照样变）；
- 清理放进**独立的空依赖 effect**（只在组件真正卸载时跑一次）。

⇒ `currentParamRange` 变化导致的重跑**不再碰 timer**，节流按预期 60ms 一次。

### ⚠️ 验证状态

已构建 + 装机（`libbackend_lib.so` 72.77 MB，前端确实重编过）。
但「拖动中是否实时更新」**必须手测**（合成 `input` 事件造不出
`lastVibratoRef` 那个前置状态）⇒ **等用户真机/模拟器拖一次确认**。

---

## 🕳️ `build-apk-bypass.sh` 有 bug（本轮踩到）

跑它 **Exit 1 且无任何输出**；但**直接跑 `bash scripts/build-apk.sh x86_64` 却完全成功**。

脚本里有 `set -euo pipefail` + `bash scripts/build-apk.sh "$ABI" 2>&1 | tail -6` +
`TAURI_RC=${PIPESTATUS[0]}` —— 这一段在 `set -e` 下**会在管道处提前退出**，
后面第二段（gradle 打包）根本没执行，所以既没输出也没产物。

⇒ **临时对策**：直接跑 `build-apk.sh <abi>`（它自己就能完整产出 APK，
本轮就是这么拿到包的）。**下次要修**：把 `PIPESTATUS` 那段用 `set +e` 包住，
或改成写临时文件再读退出码。

---

## 📋 用户新提的 6 条（2026-09-27 01:45）

| # | 内容 | 状态 |
| :-: | :--- | :--- |
| 1 | 顶栏「轨道」菜单内容要与**长按轨道头**一致 | TODO（任务 #49）|
| 2 | **#17 删底栏** —— 用户澄清：只删「轨道/参数/文件/笔记」**四个页签**，**不含** `∧`/撤销/播放那一行 | TODO（任务 #50）|
| 3 | #10 电脑版 beta14 里「长按右键单击音频块」**没出现**该功能 ⇒ **要我先核实电脑版的正确操作方法** | TODO（任务 #51）|
| 4 | **#7** 拖动滑条要**实时**更新曲线（当前松手才更新） | ✅ 已修（等手测）|
| 5 | 文件管理 / 记事本：右上角已有「关闭」⇒ **左上角别再放 ✕**；且**右上角关闭键无效，要修** | TODO（任务 #48）|
| 6 | 昨天 20:36 对话里"说了没做到也没反馈"的点 ⇒ 问清单在哪 | ✅ 已答：`TASKS.md` L267「📋 真机试用反馈」|
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

---

## 📋 用户反馈（2026-09-27 01:45）—— 6 条

**上一轮清单就在本文件 L267「📋 真机试用反馈」，剩 9 + 4 条。**

| # | 内容 | 状态 |
| :-: | :--- | :--- |
| 1 | 顶栏「轨道」菜单内容要与**长按轨道头**一致 | TODO |
| 2 | **#17 删底栏**：用户澄清只删「轨道/参数/文件/笔记」**四个页签**，**不含** `∧`/撤销/播放那一行 | TODO |
| 3 | **#10**：用户在电脑版 beta14 试了长按右键，**没出现**该功能 ⇒ **要我先核实电脑版正确操作方法**，再由用户定手机适配 | TODO |
| 4 | **#7** 拖动滑条要**实时**更新（当前松手才更新） | ✅ 已修 → 真根因见下 |
| 5 | 文件管理/记事本：**去掉左上角 ✕**（右上角已有「关闭」）；**右上角关闭键无效要修** | TODO |
| 6 | 问上轮清单在哪 | ✅ 答案：本文件 L267 |

### ✅ #7 真根因（2026-09-27 02:44）

**`usePianoRollInteractions.ts` 里注册 `onVibratoAdjustReady` 的 `useEffect`，
其 cleanup 会 `clearTimeout` 掉刚起好的 60ms 节流 timer。**

依赖数组含 `currentParamRange`（**拖动中会变**）⇒ effect 重跑 ⇒ cleanup 清 timer
⇒ `flush` 永不执行 ⇒ 只有松手（`commit:true`）那次才渲染。

⚠️ 上一轮注释说「改成 useRef 就不会被清」是**误判** —— useRef 只让变量跨 effect 存活，
cleanup 照样清它指向的 timer，而且 timer 共享、重跑时更易误伤。

**修法**：清理挪到**独立的空依赖 effect**（只在真正卸载时跑一次），注册 effect 不再碰 timer。
已构建 + 装机；**拖动实时性需手测确认**。

### 🕳️ `build-apk-bypass.sh` 有 bug

跑它 Exit 1 且**无输出**；而 `bash scripts/build-apk.sh x86_64` **完全成功**。
原因是 `set -euo pipefail` 与 `PIPESTATUS` 那段管道互动导致提前退出，第二段没执行。
**临时对策**：直接跑 `build-apk.sh <abi>`（本轮就是这么拿到包的）。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已追加 6 条")
