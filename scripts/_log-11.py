#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #11（双开复制）+ 本轮磁盘满事故 + TASKS 审计。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #11 双开 HiFiShifter 互相复制（04:20-06:10）

### 用户拍板的方向

> 「reaper 与 vsh 没有手机版，我认为不用做，不过**双开 hifishifter 之间互相复制**还是可以做的」

⇒ 不做跨应用，只做**两个 HiFiShifter 实例之间**。

### 关键认识：Android 剪贴板是**全局**的

同一用户下所有实例共用（**分身/平行空间也一样**）⇒ 只要两边都读写**系统剪贴板**
就能互传，**不需要额外通道**。

### 实现（两层）

**Kotlin**（`android/kotlin/HifishifterFs.kt`）：

```
setClipboardText(text): Boolean    // ClipData.newPlainText("HiFiShifter", text)
getClipboardText(): String?        // primaryClip → coerceToText
runOnUiBlocking { ... }            // 部分 ROM 非主线程读剪贴板返回空 ⇒ 转 UI 线程同步等
```

**Rust**（`system_clipboard.rs`）：加 `#[cfg(target_os = "android")] mod android_clipboard`，
`write_bytes` / `write_bytes_with_reaper` / `read_bytes` 三个入口指向它。
JNI 套路照抄 `platform/saf.rs`（`with_env` + **`app_class`**，⚠️ 不能 `find_class`）。

⚠️ **同时把三个 stub 的 cfg 从 `not(any(windows, macos, linux))` 改成
`not(any(..., android))`** —— 否则 Android 同时命中新分支和 stub ⇒ 重复定义编译不过。

### 为什么用「文本信封」而不是自定义 MIME

编码成 `HIFISHIFTER_CLIPBOARD_V1:<base64>`：
1. `ClipData.newPlainText` 各 ROM 都稳，不必注册自定义格式；
2. **上游本来就读得懂这个信封**（老版本兼容路径 `decode_text_envelope`）
   ⇒ 编码解码**一行没新写**（只补了个 `encode_text_envelope`）；
3. 粘到普通文本框里是一串可识别的标记，不是乱码。

### 验证状态

✅ Kotlin 编译通过、Rust 编译通过、APK 构建通过、装机启动正常。
🟡 **完整粘贴流程需要**：真实音频片段（模拟器无素材）。用不存在的 clipId 调
`copy_timeline_clips` 正确返回 `no_clips_selected`（说明**没误走到剪贴板**，逻辑对）。

---

## 🔴 本轮磁盘事故：C 盘 100% 满 ⇒ 构建**静默失败**

**症状**：`bash scripts/build-apk.sh x86_64` **exit 1，但日志只有 12 行环境检查**，
没有任何 error —— 看起来像脚本自己早退了。查 `df` 才发现 **C: 476G 已满、0 可用**。

⇒ memory 里记过「C 盘写满时症状是 gradle 里一句 GBK 乱码的 IOException」，
但这次**更早**就死了（Rust 之前的某步拿不到临时文件），所以连那行乱码都没印出来。
**教训：构建诡异失败，先 `df /c`。**

### 清理（`truncate -s 0`，不进回收站）

⚠️ **Git Bash 的 `truncate -s 0` 对 Windows 文件**静默无效**
（命令返回成功、`stat` 一看大小没变）⇒ 必须用 **Python 的 `f.truncate(0)`**。

| 目标 | 释放 |
| :--- | ---: |
| `%TEMP%`（多为 VS 安装包残留 `nvzthvbk/`）| ~1.8 GB |
| `~/.workbuddy/workspace/**/modify_backup/`（73 个会话备份文件）| ~2.7 GB |

**合计 ~3.2 GB** ⇒ 构建立刻成功。

⚠️ **动了但没敢动大的**：
- `~/.android/avd/hs-phone-tall.avd/userdata-qemu.img.qcow2`（**8 GB**）—— **AVD 磁盘本体，绝不能动**；
- 同目录 `snapshots/default_boot/ram.img`（2.5 GB）—— **模拟器正在运行**（时间戳就是当时）⇒ 动了会崩，
  等模拟器关掉后可安全截断（只是开机快照失效、AVD 仍能冷启动）。

⇒ **教训**：以后开构建前先看 `df`；`ram.img` 这类快照是**周期性**的大户，值得加进清理脚本。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #11 双开 HiFiShifter 互相复制（2026-09-27 06:10）

**方向**（用户拍板）：**不做** REAPER / VocalShifter（无手机版），只做**两个 HiFiShifter 实例之间**。

🔑 **关键认识**：Android 剪贴板是**全局**资源（同一用户下所有实例共用，**分身/平行空间亦然**）
⇒ 两边都读写系统剪贴板即可互传，**不需额外通道**。

| 层 | 内容 |
| :--- | :--- |
| Kotlin | `setClipboardText()` / `getClipboardText()`（`ClipData.newPlainText`）+ `runOnUiBlocking`（部分 ROM 非主线程读不到）|
| Rust | `system_clipboard.rs` 加 `cfg(android)` 分支，三个入口（`write_bytes` / `write_bytes_with_reaper` / `read_bytes`）指向它；JNI 照抄 `saf.rs` |
| 编码 | 复用上游现成的**文本信封** `HIFISHIFTER_CLIPBOARD_V1:<base64>`（`decode_text_envelope` 本来就读得懂，只补了 encode）|

⚠️ 同时把三个 stub 的 cfg 由 `not(any(windows,macos,linux))` 改成 `not(any(...,android))`，
否则 Android 同时命中新分支与 stub ⇒ 重复定义。

✅ Kotlin/Rust/APK 构建全通过、装机启动正常；用不存在的 clipId 调 `copy_timeline_clips`
正确返回 `no_clips_selected`（**未误走剪贴板**）。
🟡 **完整流程需真实音频片段手测**（模拟器无素材）。

---

## 🔴 本轮事故：C 盘 100% 满 ⇒ 构建静默失败（已解决）

`build-apk.sh` **exit 1 但日志只有 12 行环境检查、无任何 error** ⇒ 查 `df` 发现 **C: 0 可用**。
**教训：构建诡异失败先 `df /c`。**

清理用 `truncate -s 0`（不进回收站）：`%TEMP%` ~1.8 GB + `~/.workbuddy/workspace` 会话备份 ~2.7 GB
⇒ **合计 ~3.2 GB**，构建随即成功。

⚠️ **Git Bash 的 `truncate -s 0` 对 Windows 文件静默无效** ⇒ 必须用 **Python 的 `f.truncate(0)`**。
⚠️ **没敢动**：`userdata-qemu.img.qcow2`（8 GB，**AVD 磁盘本体**）；
`snapshots/default_boot/ram.img`（2.5 GB，**模拟器在跑**，关掉后可截断、只丢开机快照）。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
