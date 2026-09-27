#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 第一步（续）：Kotlin 侧 + setup 脚本。

- A. `android/kotlin/HifishifterFs.kt`：加 `acceptOpenIntent` + `takePendingOpenPath`；
- B. `scripts/setup-gen-android.sh` 的 MainActivity heredoc：
  - onCreate 结尾调 `acceptOpenIntent(intent)`（冷启动）；
  - **新增** `onNewIntent` 覆盖（脚本里原本没有这个方法）。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

# ── A. Kotlin 真源 ───────────────────────────────────────────────────────
KT = ROOT / "android" / "kotlin" / "HifishifterFs.kt"
t = KT.read_text(encoding="utf-8")

anchor = """    /**
     * 由 Rust 实现（`platform/saf.rs` 的 `#[no_mangle]`）。"""

addition = """    /* ── HS-OPEN-WITH-PATCH：关联文件（其他应用「打开方式」）──────────────
     *
     * Manifest 早就注册了 `ACTION_VIEW`（其他应用能看到本软件），但**点了没反应**
     * —— 因为 `MainActivity` 从没读过 `intent.data`。这里补上接收端。
     *
     * 走与 SAF 相同的**边界物化**：URI 立刻拷进 `cacheDir/saf_import/`，把真实路径
     * 交回 Rust ⇒ 上游那几十处 `std::fs::File::open(path)` 一行不改。
     * 物化直接复用 `materialize()`（含时间戳前缀 + 文件名净化 + 保中文）。
     */

    /** 最近一次「用本应用打开」的文件（真实路径）。只留一个，后到覆盖先到。 */
    @Volatile
    private var pendingOpenPath: String? = null

    /**
     * 由 `MainActivity` 在冷启动与 `onNewIntent` 时调用。
     *
     * ⚠️ 不在这里同步等待：物化可能几十毫秒到几秒（大工程文件），而这两个
     * 调用点都跑在 UI 线程。所以**只记路径**，由前端稍后主动来取。
     */
    fun acceptOpenIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        val act = activity
        if (act == null) {
            Log.w(TAG, "acceptOpenIntent: activity 尚未 attach，忽略 $uri")
            return
        }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "content" && scheme != "file") {
            Log.w(TAG, "acceptOpenIntent: 不支持的 scheme=$scheme")
            return
        }
        try {
            val path = if (scheme == "file") {
                uri.path
            } else {
                materialize(act, uri, queryDisplayName(act, uri))
            }
            if (path.isNullOrBlank()) {
                Log.w(TAG, "acceptOpenIntent: 物化结果为空（$uri）")
                return
            }
            pendingOpenPath = path
            Log.i(TAG, "关联文件已接收 → $path")
        } catch (t: Throwable) {
            Log.w(TAG, "acceptOpenIntent: 物化失败（$uri）", t)
        }
    }

    /**
     * 由 Rust 经 JNI 调用（`CallStaticObjectMethod`，返回 `java.lang.String` 或 null）。
     * **取一次即清** —— 否则每次启动都会重复导入同一个文件。
     */
    @JvmStatic
    fun takePendingOpenPath(): String? {
        val p = pendingOpenPath
        pendingOpenPath = null
        return p
    }

    /**
     * 由 Rust 实现（`platform/saf.rs` 的 `#[no_mangle]`）。"""

assert t.count(anchor) == 1, f"A 锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)
KT.write_text(t, encoding="utf-8")
print("✓ A. HifishifterFs.kt 加了 acceptOpenIntent + takePendingOpenPath")

# ── B. setup 脚本 ────────────────────────────────────────────────────────
SH = ROOT / "scripts" / "setup-gen-android.sh"
s = SH.read_text(encoding="utf-8")

# B1. onCreate 结尾（录制权限那行之后）补 acceptOpenIntent
old1 = """    window.decorView.postDelayed({ ensureRecordAudioPermission() }, 1500)
  }"""
new1 = """    window.decorView.postDelayed({ ensureRecordAudioPermission() }, 1500)

    // HS-OPEN-WITH-PATCH —— 冷启动：从「打开方式」进来的文件先把 URI 物化并记下，
    // 前端起来后主动来取（见 HifishifterFs.acceptOpenIntent 的注释）。
    HifishifterFs.acceptOpenIntent(intent)
  }

  /**
   * HS-OPEN-WITH-PATCH —— 应用已在后台时，从「打开方式」进来的文件走这里
   * （launchMode 为 singleTask 时不会重走 onCreate）。
   * 原有两条转发保持不变，只在最后补一句。
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    pluginManager.onNewIntent(intent)
    HifishifterFs.acceptOpenIntent(intent)
  }"""
assert s.count(old1) == 1, f"B1 锚命中 {s.count(old1)}"
s = s.replace(old1, new1, 1)
print("✓ B1. setup 脚本：onCreate 结尾 + 新增 onNewIntent")

SH.write_text(s, encoding="utf-8")
