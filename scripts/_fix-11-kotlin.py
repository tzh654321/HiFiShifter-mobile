#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#11 双开 HiFiShifter 互相复制 —— Kotlin 侧（Android 系统剪贴板）。

## 为什么用「文本信封」而不是自定义 MIME

上游 `system_clipboard.rs` 本来就有两套编码：
- Windows 用**自定义剪贴板格式**（`application/x-hifishifter-object`）装二进制；
- 同时**永远**在 `text/plain` 里放一个短摘要（人类可读，避免粘到文本框里变 base64 垃圾），
  并且**读**的时候兼容老版本的 `HIFISHIFTER_CLIPBOARD_V1:<base64>` 文本信封。

⇒ Android 这一路走**文本信封**最省事也最兼容：
- `ClipData.newPlainText` 是各 ROM 都稳的写法，不需要注册自定义 MIME；
- 上游 `decode_text_envelope` / `encode` 直接能用（**不在 Android 上另造一套编码**）；
- **双开互通**：Android 剪贴板是**全局**资源（同一用户下所有实例共用，包括分身/平行空间）
  ⇒ 只要两边都读写系统剪贴板就能互传，不需要额外通道。
- 「粘到别的应用」也不会出问题：文本是 `HIFISHIFTER_CLIPBOARD_V1:<base64>`，
  普通文本框粘进去就是一串可识别的标记（而不是原始二进制垃圾）。

## 接口

```
setClipboardText(text)     写（从 Rust 调，payload 是 base64 信封）
getClipboardText(): String? 读（从 Rust 调）
```

⚠️ 两者都必须在 **UI 线程**上用 `Handler` 调 —— Android 10+ 的剪贴板 API
虽然不强制，但部分 ROM 在非主线程读剪贴板会返回空。
这里用 `runOnUiThread` + `CountDownLatch` 同步等待（调用方本来就在非 UI 线程，
反正要等 JNI 返回）。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
KT = ROOT / "android" / "kotlin" / "HifishifterFs.kt"
t = KT.read_text(encoding="utf-8")

anchor = """    /* ── HS-OPEN-WITH-PATCH：关联文件（其他应用「打开方式」）──────────────"""

addition = """    /* ── HS-CLIPBOARD-PATCH：Android 系统剪贴板（#11）─────────────────────
     *
     * 用户口径：**不用做 REAPER/VocalShifter**（它们没有手机版），
     * 但「**两个 HiFiShifter 实例之间互相复制**」要做。
     *
     * Android 的剪贴板是**全局**资源（同一用户下所有实例共用，分身/平行空间也一样）
     * ⇒ 两边都读写系统剪贴板即可互传，不需要额外通道。
     *
     * ⚠️ 走**文本信封**（`HIFISHIFTER_CLIPBOARD_V1:<base64>`）而不是自定义 MIME：
     * ① `ClipData.newPlainText` 各 ROM 都稳，不用注册格式；
     * ② 上游 `system_clipboard.rs` 本来就读得懂这个信封（老版本兼容路径），
     *    编码解码**一行都不用新写**；
     * ③ 粘到普通文本框里是一串可识别的标记，不是乱码。
     */

    /** 写系统剪贴板。`text` 应当已是 `HIFISHIFTER_CLIPBOARD_V1:<base64>` 信封。 */
    @JvmStatic
    fun setClipboardText(text: String): Boolean {
        val act = activity ?: return false
        return runOnUiBlocking(act) {
            try {
                val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: return@runOnUiBlocking false
                cm.setPrimaryClip(ClipData.newPlainText("HiFiShifter", text))
                Log.i(TAG, "setClipboardText: 已写入 ${text.length} 字符")
                true
            } catch (t: Throwable) {
                Log.w(TAG, "setClipboardText 失败", t)
                false
            }
        }
    }

    /** 读系统剪贴板；没有文本或没有权限时返回 null。 */
    @JvmStatic
    fun getClipboardText(): String? {
        val act = activity ?: return null
        return runOnUiBlocking(act) {
            try {
                val cm = act.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    ?: return@runOnUiBlocking null
                val clip = cm.primaryClip ?: return@runOnUiBlocking null
                if (clip.itemCount <= 0) return@runOnUiBlocking null
                val cs = clip.getItemAt(0).coerceToText(act)?.toString()
                if (cs.isNullOrEmpty()) null else cs
            } catch (t: Throwable) {
                // Android 12+ 在应用不在前台时读剪贴板会抛或被系统记一条提示 ——
                // 这里当成"没有数据"，不往上冒错。
                Log.w(TAG, "getClipboardText 失败：${t.message}")
                null
            }
        }
    }

    /**
     * 在 **UI 线程**上同步跑一段代码并等它结束。
     *
     * 为什么必须转 UI 线程：部分 ROM 在非主线程访问剪贴板会直接返回空。
     * 调用方（Rust 经 JNI）本来就在非 UI 线程、并且要等返回值，所以同步等待没有副作用。
     */
    private fun <T> runOnUiBlocking(act: Activity, block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: T? = null
        val latch = CountDownLatch(1)
        act.runOnUiThread {
            try {
                result = block()
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    /* ── HS-OPEN-WITH-PATCH：关联文件（其他应用「打开方式」）──────────────"""

assert t.count(anchor) == 1, f"锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)

# 补 import
old_imp = "import android.app.Activity"
new_imp = """import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit"""
assert t.count(old_imp) >= 1, "import 锚未命中"
t = t.replace(old_imp, new_imp, 1)

KT.write_text(t, encoding="utf-8")
print("✓ Kotlin：加了 setClipboardText / getClipboardText / runOnUiBlocking + import")
