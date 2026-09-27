#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修 `android/kotlin/HifishifterFs.kt` 的 5 个 Kotlin 编译错误。

这个 452 行版本是**半成品** —— 我最初误以为 gen 里的 198 行是旧版、把它拷了过去，
一编译就暴露 5 处错误，全在我没碰的地方 ⇒ 它本来就编不过。
（它比 gen 版多了 SAF v2：`savedTreeUri` / `listTreeChildren` / `stagingDir` /
`writeToUri` / 保存位置记忆 ⇒ 修好它比回退划算。）

## 5 处

| 位置 | 错误 | 修法 |
| :--- | :--- | :--- |
| L150 | `mime` / `suggestedName` 未解析 | `pending` 由 `Pair<Long,Int>` 改成三元组，把 mime/suggestedName 也存进去 |
| L296 | `@JvmStatic` 重复 | 删一行 |
| L321/323 | 表达式体里不能 `return` | `writeToUri` 改块体 |
| L327 | `uri` 未解析（参数叫 `uriString`）| 改名 |
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
KT = ROOT / "android" / "kotlin" / "HifishifterFs.kt"
t = KT.read_text(encoding="utf-8")

# ① pending 扩展：Pair<Long,Int> → Triple 不够（要 4 个）⇒ 用 data class
old1 = "    private val pending = ConcurrentHashMap<Int, Pair<Long, Int>>()"
new1 = """    /** 一次 SAF 请求的上下文：结果回来时要用 mime / suggestedName 记住保存位置。 */
    private data class PendingReq(
        val requestId: Long,
        val kind: Int,
        val mime: String,
        val suggestedName: String?,
    )

    private val pending = ConcurrentHashMap<Int, PendingReq>()"""
assert t.count(old1) == 1, f"① pending 锚命中 {t.count(old1)}"
t = t.replace(old1, new1, 1)
print("✓ ① pending 改成 PendingReq（含 mime / suggestedName）")

old2 = "        pending[requestCode] = requestId to kind"
new2 = "        pending[requestCode] = PendingReq(requestId, kind, mime, suggestedName)"
assert t.count(old2) == 1, f"② 写入锚命中 {t.count(old2)}"
t = t.replace(old2, new2, 1)
print("✓ ② 写入处同步")

old3 = "        val (requestId, kind) = entry"
new3 = """        val requestId = entry.requestId
        val kind = entry.kind"""
assert t.count(old3) == 1, f"③ 解构锚命中 {t.count(old3)}"
t = t.replace(old3, new3, 1)
print("✓ ③ 取出处同步")

# ④ 删重复 @JvmStatic
old4 = """    @JvmStatic
    @JvmStatic
    fun stagingDir(): String? {"""
new4 = """    @JvmStatic
    fun stagingDir(): String? {"""
assert t.count(old4) == 1, f"④ 锚命中 {t.count(old4)}"
t = t.replace(old4, new4, 1)
print("✓ ④ 删掉重复的 @JvmStatic")

# ⑤ writeToUri：表达式体 → 块体；uri → uriString
old5 = """    fun writeToUri(uriString: String, srcPath: String): Boolean =
        try {
            val act = activity ?: return false
            val src = File(srcPath)
            if (!src.isFile) return false
            val written = act.contentResolver.openOutputStream(Uri.parse(uriString), "wt")?.use { out ->
                src.inputStream().use { it.copyTo(out) }
            }
            Log.i(TAG, "writeToUri: ${src.length()} B → $uri（stream=${written != null}）")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "writeToUri($uriString) 失败", t)
            false
        }"""
new5 = """    fun writeToUri(uriString: String, srcPath: String): Boolean {
        return try {
            val act = activity ?: return false
            val src = File(srcPath)
            if (!src.isFile) return false
            val written = act.contentResolver.openOutputStream(Uri.parse(uriString), "wt")?.use { out ->
                src.inputStream().use { it.copyTo(out) }
            }
            Log.i(TAG, "writeToUri: ${src.length()} B → $uriString（stream=${written != null}）")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "writeToUri($uriString) 失败", t)
            false
        }
    }"""
assert t.count(old5) == 1, f"⑤ 锚命中 {t.count(old5)}"
t = t.replace(old5, new5, 1)
print("✓ ⑤ writeToUri 改块体 + uri → uriString")

KT.write_text(t, encoding="utf-8")
print("✓ 已写回 android/kotlin/HifishifterFs.kt")
