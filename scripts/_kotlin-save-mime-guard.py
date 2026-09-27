#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Kotlin 侧：① `*/*` 兜底；② stagingDir / writeToUri 加诊断日志。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "android" / "kotlin" / "HifishifterFs.kt"
text = P.read_text(encoding="utf-8")

# ① KIND_SAVE 的 type 兜底
a1 = """                type = mime.ifEmpty { "application/octet-stream" }
                suggestedName?.takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TITLE, it) }"""
b1 = """                // 🔴 `ACTION_CREATE_DOCUMENT` 的 type 必须是**具体** MIME：
                // `*/*` 在部分 ROM（ColorOS 实测）上会让创建流程异常、回传空 data，
                // 我们那边就判成「用户取消」—— 这正是「工程保存失败但 WAV 导出正常」的原因
                // （工程 exts 混了 json，在 Rust 侧落到 `*/*`；Rust 侧已改，这里再兜一层）。
                type = mime.takeIf { it.isNotEmpty() && it != "*/*" }
                    ?: "application/octet-stream"
                suggestedName?.takeIf { it.isNotEmpty() }?.let { putExtra(Intent.EXTRA_TITLE, it) }"""
assert text.count(a1) == 1, "a1"
text = text.replace(a1, b1, 1)

# ② stagingDir 加日志（它是 save_file 的前置，失败会直接变成"已取消"）
a2 = """    fun stagingDir(): String? =
        activity?.let { File(it.cacheDir, EXPORT_DIR).apply { mkdirs() }.absolutePath }"""
b2 = """    @JvmStatic
    fun stagingDir(): String? {
        val act = activity
        if (act == null) {
            Log.w(TAG, "stagingDir: Activity 尚未 attach —— Rust 侧会拿到空串并报错")
            return null
        }
        val dir = File(act.cacheDir, EXPORT_DIR)
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "stagingDir: 创建中转目录失败 ${dir.absolutePath}")
        }
        val p = dir.absolutePath
        Log.i(TAG, "stagingDir: $p")
        return p
    }"""
assert text.count(a2) == 1, "a2"
text = text.replace(a2, b2, 1)

# ③ writeToUri 打点（成功/失败都要能看见，否则"上传没发生"和"上传失败"分不清）
a3 = """            act.contentResolver.openOutputStream(Uri.parse(uriString), "wt")?.use { out ->
                src.inputStream().use { it.copyTo(out) }
            }
            true"""
b3 = """            val written = act.contentResolver.openOutputStream(Uri.parse(uriString), "wt")?.use { out ->
                src.inputStream().use { it.copyTo(out) }
            }
            Log.i(TAG, "writeToUri: ${src.length()} B → $uri（stream=${written != null}）")
            true"""
assert text.count(a3) == 1, "a3"
text = text.replace(a3, b3, 1)

P.write_text(text, encoding="utf-8")
print("✓ Kotlin：type 兜底 + stagingDir / writeToUri 诊断日志")
