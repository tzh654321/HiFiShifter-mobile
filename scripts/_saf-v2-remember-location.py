#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SAF v2 第二轮：① 诊断 resultCode；② 「记住上次保存位置」（用户明确要求）。

用户反馈：
  · 保存能打开原生文件管理了 ✓
  · 但点保存仍报「已取消保存」、只留下 0 B 文件
  · 「一个工程只有初次保存需要打开文件管理，所有软件都是这么设计的」

前半段说明 `ACTION_CREATE_DOCUMENT` 的**返回码判定**有问题（日志里我们的新分支已经在跑，
但落到 `Ok(None)`）。后半段是新需求：按用途记住上次选的 URI，之后不再弹框。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "android" / "kotlin" / "HifishifterFs.kt"
text = P.read_text(encoding="utf-8")

# ── ① KIND_SAVE 的 Intent 补上可持久化的写权限 ────────────────────────────────
a1 = """            KIND_SAVE -> Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime.ifEmpty { "application/octet-stream" }
                suggestedName?.takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TITLE, it) }
            }"""
b1 = """            KIND_SAVE -> Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime.ifEmpty { "application/octet-stream" }
                suggestedName?.takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TITLE, it) }
                // ⚠️ 这两个 flag 是「记住上次位置」的前提：拿到 URI 后要
                // takePersistableUriPermission，才有跨会话的写权限。
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }"""
assert text.count(a1) == 1, "a1"
text = text.replace(a1, b1, 1)

# ── ② onActivityResult：加诊断日志 + 持久化授权 + 记住位置 ────────────────────
a2 = """        if (resultCode != Activity.RESULT_OK) {
            // 用户点返回/取消 —— Rust 侧会映射成 `Ok(None)`，与上游"已取消"语义一致。
            nativeOnResult(requestId, kind, null, null, "saf_cancelled")
            return
        }
        val uri = data?.data
        val act = activity
        if (uri == null || act == null) {
            nativeOnResult(requestId, kind, null, null, if (uri == null) "saf_no_uri" else "saf_no_activity")
            return
        }"""
b2 = """        // 🔴 2026-09-22：这里必须留下 resultCode —— 用户报「点保存却显示已取消」，
        //    而日志里只能看到 Rust 侧那句「→ 用户取消」，**看不出到底是谁判的取消**。
        //    两条来源截然不同：resultCode 不对（系统/我们误判）vs 用户真按了返回。
        Log.i(TAG, "onActivityResult rc=$requestCode kind=$kind resultCode=$resultCode " +
                "hasData=${data != null} uri=${data?.data}")
        if (resultCode != Activity.RESULT_OK) {
            // 用户点返回/取消 —— Rust 侧会映射成 `Ok(None)`，与上游"已取消"语义一致。
            nativeOnResult(requestId, kind, null, null, "saf_cancelled")
            return
        }
        val uri = data?.data
        val act = activity
        if (uri == null || act == null) {
            nativeOnResult(requestId, kind, null, null, if (uri == null) "saf_no_uri" else "saf_no_activity")
            return
        }
        if (kind == KIND_SAVE) {
            // 把这次选的位置记下来：同一个用途下次直接用，不再弹框
            // （用户口径：一个工程只有初次保存需要打开文件管理）。
            val key = saveKey(mime, suggestedName)
            runCatching {
                act.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            }.onFailure { Log.w(TAG, "takePersistableUriPermission 失败（下次仍会弹框）", it) }
            prefs(act).edit().putString(key, uri.toString()).apply()
            Log.i(TAG, "已记住保存位置 [$key] = $uri")
        }"""
assert text.count(a2) == 1, "a2"
text = text.replace(a2, b2, 1)

# ── ③ request：保存方向先查"上次位置"，命中就不弹框 ───────────────────────────
a3 = """        val requestCode = RC_BASE + slot.getAndIncrement() % RC_SLOTS
        pending[requestCode] = requestId to kind"""
b3 = """        // 保存方向：同一个「用途」上次已经选过位置就直接复用，**不再弹框**
        //（用户口径：一个工程只有初次保存需要打开文件管理）。
        if (kind == KIND_SAVE) {
            val key = saveKey(mime, suggestedName)
            val saved = prefs(act).getString(key, null)
            if (saved != null && saved.isNotEmpty()) {
                Log.i(TAG, "复用已记住的保存位置 [$key] = $saved")
                nativeOnResult(requestId, kind, saved, suggestedName, null)
                return
            }
        }

        val requestCode = RC_BASE + slot.getAndIncrement() % RC_SLOTS
        pending[requestCode] = requestId to kind"""
assert text.count(a3) == 1, "a3"
text = text.replace(a3, b3, 1)

# ── ④ 辅助：SharedPreferences + 用途 key ──────────────────────────────────────
a4 = """    // ── 内部 ────────────────────────────────────────────────────────────────"""
b4 = """    // ── 内部 ────────────────────────────────────────────────────────────────

    private const val PREFS = "hs_saf_save_targets"

    private fun prefs(act: Activity) = act.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)

    /**
     * 「用途」标识：同一个用途 = 同一个保存位置。
     *
     * 用 **MIME** 区分（`audio/*` = 导出音频、`audio/midi` = 导出 MIDI、`*/*` = 工程…），
     * 这样"导出 WAV 的位置"和"工程保存的位置"互不干扰 —— 与各家软件的直觉一致。
     * 文件名只作为兜底（有些调用会传更具体的 mime）。
     */
    private fun saveKey(mime: String, suggestedName: String?): String {
        val ext = suggestedName?.substringAfterLast('.', "")?.lowercase().orEmpty()
        return if (mime.isNotEmpty()) "mime:$mime|ext:$ext" else "ext:$ext"
    }"""
assert text.count(a4) == 1, "a4"
text = text.replace(a4, b4, 1)

# ── ⑤ request 的签名要多带 mime/suggestedName（原实现只在这里用到 kind）──────
# 检查：request 是否已有这两个参数
assert "fun request(requestId: Long, kind: Int, mime: String, suggestedName: String?)" in text, \
    "request 签名与预期不符"

P.write_text(text, encoding="utf-8")
print("✓ HifishifterFs.kt：resultCode 诊断 + 记住保存位置 + 可持久化授权")
