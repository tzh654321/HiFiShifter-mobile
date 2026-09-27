#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #9 完整交付。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## ✅ #9 关联文件送进导入流程 —— 完成（03:25-07:30）

### 三层改动

| 层 | 文件 | 内容 |
| :--- | :--- | :--- |
| **Kotlin** | `android/kotlin/HifishifterFs.kt`（真源）| `acceptOpenIntent(intent)` 物化 URI 存 `pendingOpenPath`；`@JvmStatic takePendingOpenPath()` 取一次即清 |
| **setup** | `scripts/setup-gen-android.sh` | MainActivity heredoc：`onCreate` 结尾 + **新增 `onNewIntent`** 各调一次 `acceptOpenIntent` |
| **Rust** | `platform/saf.rs` | `take_pending_open_path()`：`with_env` + `app_class`（⚠️ 不能 `find_class`）+ `call_static_method(..., "()Ljava/lang/String;", &[])` |
| **Rust** | `commands.rs` + `lib.rs` | `take_pending_open_file` 命令 + 注册 |
| **前端** | `services/api/project.ts` + `App.tsx` | API 包装；启动 + `visibilitychange` 各取一次，`.hshp/.hsp/.json` 走现成的 `openProjectFromPath` |

**物化直接复用现成的 `materialize()`**（`saf_import/` 缓存 + 时间戳前缀 + 中文安全 +
24h 清理），一行新逻辑没写。

### ✅ 实测（模拟器）

```
adb shell am start -a android.intent.action.VIEW \\
  -d "file:///sdcard/Download/hs-openwith-test.hshp" -n com.arounder.hifishifter/.MainActivity

→ logcat: I HS-SAF : 关联文件已接收 → /sdcard/Download/hs-openwith-test.hshp   ✅
→ CDP:    invoke('take_pending_open_file') → {"ok":true,"path":null}          ✅
          （null = 前端启动时已取走并清空 ⇒ 取一次即清的语义正确）
```

### 🕳️ 踩到的坑（都值得记）

1. **`android/kotlin/HifishifterFs.kt` 是个**半成品**（452 行），比 `gen/` 里的
   （198 行）多 SAF v2 功能，但**根本编译不过**（5 处错误，全在我没碰的地方）。
   我一上来误以为 gen 里的旧、把它拷进 gen，结果一编译就炸。
   ⇒ **教训**：拷「真源」进生成目录前，**先单独编一次**，别假设它一定是对的。
   已顺手修好那 5 处：
   - `pending` 由 `Pair<Long,Int>` 扩成 `PendingReq(requestId, kind, mime, suggestedName)`
     （原先 `onActivityResult` 里用 `mime`/`suggestedName` 却没地方取）；
   - 删重复的 `@JvmStatic`；
   - `writeToUri` 由表达式体改块体（表达式体里不能 `return`）；
   - `$uri` → `$uriString`（参数名不符）。
2. **改 `#[tauri::command]` 函数时，注释插错位置会把属性"抢"给上/下一个函数**。
   我给 `open_project_dialog` 前插新函数，属性行留在了原处 ⇒ 变成修饰我的新函数
   ⇒ 报 `could not find __cmd__open_project_dialog`（**编译期看不出是属性错位**）。
   ⇒ **教训**：插函数时**连 `#[tauri::command]` 那行一起**作为锚，或者插完 `grep -B3` 复核。
3. **`am start` 传 `content://` 没带授权 ⇒ `SecurityException`**；但我第一次看日志
   时看到的是这条异常，差点误判成"我的代码坏了"。
   ⇒ 验证关联文件用 **`file://`** 最省事（我的代码两个 scheme 都支持）。
4. `console.info` **不落盘**（memory 早记过）⇒ 前端链路要靠 CDP 或 Rust 侧日志验证。

### ⚠️ 待办

- **`gen/android` 是生成物** ⇒ Kotlin 改动已同步进 `scripts/setup-gen-android.sh`，
  但**补丁也要 regen**（`HifishifterFs.kt` 属 0003，`commands.rs`/`lib.rs`/`saf.rs` 也是）。
- **音频文件**（非 `.hshp`）目前只记日志，未接入导入 —— 导入入口分支多，待单独处理。
- 真机验证（模拟器已过）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #9 关联文件送进导入流程（2026-09-27 07:30）

| 层 | 落点 | 内容 |
| :--- | :--- | :--- |
| Kotlin | `android/kotlin/HifishifterFs.kt` | `acceptOpenIntent()` 物化并暂存；`takePendingOpenPath()` 取一次即清 |
| setup | `setup-gen-android.sh` | MainActivity 的 `onCreate` 结尾 + **新增 `onNewIntent`** 各调一次 |
| Rust | `platform/saf.rs` | `take_pending_open_path()`（`with_env` + `app_class` + `call_static_method`）|
| Rust | `commands.rs` / `lib.rs` | 命令 `take_pending_open_file` + 注册 |
| 前端 | `project.ts` / `App.tsx` | API + 启动/恢复时取一次，`.hshp` 走现成的 `openProjectFromPath` |

**物化直接复用现成的 `materialize()`**（缓存 + 时间戳 + 中文安全 + 24h 清理）。

✅ **实测**：`am start -a VIEW -d file:///sdcard/.../hs-openwith-test.hshp`
⇒ logcat `I HS-SAF : 关联文件已接收 → /sdcard/Download/hs-openwith-test.hshp`；
CDP `invoke('take_pending_open_file')` 返回 `{"ok":true,"path":null}`
（null = 启动时已取走 ⇒ "取一次即清"语义正确）。

🕳️ **顺带修好** `android/kotlin/HifishifterFs.kt` 的 **5 个既有编译错误**
（半成品：`pending` 缺 mime 字段、重复 `@JvmStatic`、`writeToUri` 表达式体里 `return`、`$uri` 拼错）。

⚠️ **待办**：音频文件（非 `.hshp`）暂只记日志；**补丁要 regen**（含 `commands.rs` 等补丁范围外文件）；真机验证。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
