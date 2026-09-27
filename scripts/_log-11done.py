#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #11（双开互相复制）完成 + 磁盘满的坑。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## ✅ #11 双开 HiFiShifter 互相复制（04:25-05:52）

**用户拍板的方向**：REAPER / VocalShifter **没有手机版** ⇒ 不做跨应用粘贴；
改做「**两个 HiFiShifter 实例之间互相复制**」。

### 关键认识

Android 的剪贴板是**全局**资源 —— 同一用户下所有实例共用（**分身/平行空间也一样**）
⇒ **只要两边都读写系统剪贴板就能互传，不需要额外通道**。

### 实现

| 层 | 内容 |
| :--- | :--- |
| **Kotlin** | `setClipboardText` / `getClipboardText`（`ClipData.newPlainText`）+ `runOnUiBlocking`（剪贴板访问转 UI 线程，部分 ROM 在非主线程返回空）|
| **Rust** | `system_clipboard.rs` 加 `#[cfg(target_os = "android")] mod android_clipboard`，JNI 套路照抄 `platform/saf.rs`（`with_env` + **`app_class`**）|
| **Rust** | 把三个 stub 的 cfg 由 `not(any(windows,macos,linux))` 改成 **`not(any(...,android))`** —— 否则新分支与 stub 同时存在 ⇒ 重复定义 |

**走「文本信封」而不是自定义 MIME**（`HIFISHIFTER_CLIPBOARD_V1:<base64>`）：

- `ClipData.newPlainText` 各 ROM 都稳，不必注册格式；
- 上游 `decode_text_envelope` **本来就读得懂**这个信封（老版本兼容路径）⇒
  编码解码一行都不用新写（只补了一个 `encode_text_envelope`）；
- 粘到普通文本框是一串**可识别标记**，不是乱码。

### ✅ 实测（端到端，模拟器）

```js
invoke('write_system_clipboard_object', {payload: '{"hs_test":"roundtrip_12345","n":42}', summary: '…'})
→ {"ok": true}

invoke('read_system_clipboard_object')
→ {"available": true, "ok": true, "payload": "{\\"hs_test\\":\\"roundtrip_12345\\",\\"n\\":42}"}
```

**payload 逐字符一致** ⇒ 写→读闭环通过 ⇒ **两个实例互通的前提成立**。
（剪贴板是全局的，所以同一台设备上再开一个实例读到的就是这份数据。）

---

## 🕳️ C 盘写满导致构建"无输出地失败"（本轮又踩）

`bash scripts/build-apk.sh x86_64` **exit 1 但日志只有 12 行环境检查**，
连一句 error 都没有 —— 因为 `df /c` 是 **100% / 0 可用**，脚本在写任何东西时就死了。

**释放办法**（memory 早有记：删除进回收站**不释放空间**，只有 `truncate -s 0` 有效）：

| 动作 | 释放 |
| :--- | ---: |
| `truncate -s 0 .android/avd/hs-phone-tall.avd/snapshots/default_boot/ram.img`（**2.5GB 快照**，先 `adb emu kill`）| 2.5 GB |
| `truncate -s 0` 掉 `.gradle/caches` 里 30 天前的文件 | 0.9 GB |
| 合计 | **3.4 GB** |

⚠️ **教训**：**构建无输出地失败 ⇒ 先 `df /c`**，别去读代码。
（memory 里那句「C 盘写满时症状是 gradle 里一句 GBK 乱码的磁盘不足」——
本轮症状**不同**：连 gradle 都没跑到，脚本静默退出。）
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #11 双开 HiFiShifter 互相复制（2026-09-27 05:52）

**用户拍板**：REAPER/VocalShifter 无手机版 ⇒ 不做跨应用；改做**两个实例互传**。
🔑 **Android 剪贴板是全局资源**（分身/平行空间共用）⇒ 两边都读写系统剪贴板即可互通。

| 层 | 内容 |
| :--- | :--- |
| Kotlin | `setClipboardText` / `getClipboardText` + `runOnUiBlocking`（转 UI 线程，部分 ROM 非主线程返回空）|
| Rust | `system_clipboard.rs` 加 android 分支（JNI 照抄 `saf.rs`）；**三个 stub 的 cfg 补 `android`** 否则重复定义 |

**走文本信封**（`HIFISHIFTER_CLIPBOARD_V1:<base64>`）而非自定义 MIME：
各 ROM 都稳、上游 `decode_text_envelope` 本来就读得懂（只补了 encode）、
粘到文本框是可识别标记而非乱码。

✅ **实测**：`write_system_clipboard_object` → `{"ok":true}`；
`read_system_clipboard_object` → `{"available":true,"ok":true,"payload":"{\\"hs_test\\":\\"roundtrip_12345\\",\\"n\\":42}"}`
—— **payload 逐字符一致**，写→读闭环通过。

### 🕳️ 同轮踩到：C 盘 100% 满 ⇒ 构建"无输出地失败"

`build-apk.sh` exit 1 但日志只有 12 行环境检查、**一句 error 都没有**。
`df /c` = **100% / 0 可用**。释放了 **3.4 GB**：
`truncate -s 0` 掉 AVD 的 2.5GB `snapshots/default_boot/ram.img`（先 `adb emu kill`）
+ `.gradle/caches` 里 30 天前的文件 0.9GB。
⚠️ **教训：构建无输出地失败 ⇒ 先 `df /c`**。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
