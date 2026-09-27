#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#8 批 1/3：Kotlin 侧 —— tree 目录授权 + 通过 SAF 列目录。

用户的决定：**用 SAF**，软件内文件管理界面默认打开 `/storage/emulated/0/HiFiShifter`。

为什么必须走 SAF：Android 11+ 的分区存储下，应用**不能**用真实路径读
`/storage/emulated/0/` 下的目录（会 EACCES）。SAF 的 `ACTION_OPEN_DOCUMENT_TREE`
让用户授权一棵子树，之后用 `DocumentsContract` 列目录、读文件。

⚠️ 特意**不引 `androidx.documentfile`**：那要加依赖（还要 gradle 同步），
而系统自带的 `DocumentsContract`（API 21+）够用 —— 少一个依赖少一份打包风险。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "android" / "kotlin" / "HifishifterFs.kt")
t = P.read_text(encoding="utf-8")

# ── ① KIND_TREE 的授权回传（原逻辑会走 materialize，对目录不适用）─────────────
old = """            if (kind == KIND_SAVE) {
                // 保存方向：URI 是"写到哪里"，**不能** materialize（此时 cacheDir 里还没东西）。
                // 把 URI 原样回传，Rust 侧生成 cacheDir 临时路径给调用方写，写完再经
                // `writeToUri` 送回来。见 docs/11 §3.5。
                nativeOnResult(requestId, kind, uri.toString(), name, null)
            } else {"""
new = """            if (kind == KIND_SAVE) {
                // 保存方向：URI 是"写到哪里"，**不能** materialize（此时 cacheDir 里还没东西）。
                // 把 URI 原样回传，Rust 侧生成 cacheDir 临时路径给调用方写，写完再经
                // `writeToUri` 送回来。见 docs/11 §3.5。
                nativeOnResult(requestId, kind, uri.toString(), name, null)
            } else if (kind == KIND_TREE) {
                // 目录（#8）：把 tree URI 原样回传，并**持久化授权**，否则进程重启后失效。
                // 目录同样不能 materialize（里面可能成千上万个文件）。
                runCatching {
                    act.contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                }.onFailure { Log.w(TAG, "tree 持久化授权失败（重启后要重新选目录）", it) }
                prefs(act).edit().putString(PREF_TREE_URI, uri.toString()).apply()
                Log.i(TAG, "已记住目录授权：$uri")
                nativeOnResult(requestId, kind, uri.toString(), name, null)
            } else {"""
assert t.count(old) == 1, "KIND_TREE 分支锚不唯一"
t = t.replace(old, new, 1)

# KIND_TREE 的 Intent 需要读写权限 flag
old = """            KIND_TREE -> Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }"""
new = """            KIND_TREE -> Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // 写权限 + 可持久化：默认目录要能**建目录/写录音/写工程**，且重启后仍有效。
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }"""
assert t.count(old) == 1, "KIND_TREE Intent 锚不唯一"
t = t.replace(old, new, 1)

# ── ② 常量 ───────────────────────────────────────────────────────────────────
old = """    private const val PREFS = "hs_saf_save_targets\""""
new = """    private const val PREFS = "hs_saf_save_targets"

    /** #8：默认音乐目录的授权（tree URI）存在这里。 */
    private const val PREF_TREE_URI = "tree_uri\""""
assert t.count(old) == 1, "PREFS 常量锚不唯一"
t = t.replace(old, new, 1)

# ── ③ 新增：列目录 + 读回已授权 URI ─────────────────────────────────────────
old = """    /**
     * 由 Rust 经 JNI 调用：给出导出中转目录的**绝对路径**（不存在则创建）。"""
new = """    /** 已授权的默认目录 tree URI（没授权过返回空串）。 */
    @JvmStatic
    fun savedTreeUri(): String {
        val act = activity ?: return ""
        return prefs(act).getString(PREF_TREE_URI, "") ?: ""
    }

    /**
     * 列出 tree 下 `relPath` 的子项，返回 JSON 数组。
     *
     * 每项：`{name, docId, isDir, size, modified}`（size/modified 取不到时 -1）。
     * 用系统 `DocumentsContract` 而不是 `DocumentFile`，省掉一个 gradle 依赖。
     *
     * ⚠️ 必须在**非 UI 线程**调用（要走 ContentResolver）。
     */
    @JvmStatic
    fun listTreeChildren(treeUri: String, relPath: String): String {
        val act = activity ?: return "[]"
        return try {
            val tree = Uri.parse(treeUri)
            // 从 tree 根逐个下钻到 relPath
            var docUri = DocumentsContract.buildDocumentUriUsingTree(
                tree,
                DocumentsContract.getTreeDocumentId(tree),
            )
            for (seg in relPath.split('/').filter { it.isNotEmpty() }) {
                docUri = findChildByName(act, tree, docUri, seg) ?: return "[]"
            }
            val docId = DocumentsContract.getDocumentId(docUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
            val out = JSONArray()
            act.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                ),
                null,
                null,
                null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val mime = c.getString(2)
                    out.put(
                        JSONObject().apply {
                            put("name", c.getString(1) ?: "")
                            put("docId", c.getString(0) ?: "")
                            put("isDir", mime == DocumentsContract.Document.MIME_TYPE_DIR)
                            put("size", if (c.isNull(3)) -1L else c.getLong(3))
                            put("modified", if (c.isNull(4)) -1L else c.getLong(4))
                        },
                    )
                }
            }
            out.toString()
        } catch (t: Throwable) {
            Log.w(TAG, "listTreeChildren($treeUri, $relPath) 失败", t)
            "[]"
        }
    }

    /** 在 `parent` 下按显示名找子项，返回其 document URI。 */
    private fun findChildByName(
        act: Activity,
        tree: Uri,
        parent: Uri,
        name: String,
    ): Uri? = try {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            tree,
            DocumentsContract.getDocumentId(parent),
        )
        var found: String? = null
        act.contentResolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            ),
            null,
            null,
            null,
        )?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(1) == name) {
                    found = c.getString(0)
                    break
                }
            }
        }
        found?.let { DocumentsContract.buildDocumentUriUsingTree(tree, it) }
    } catch (t: Throwable) {
        Log.w(TAG, "findChildByName($name) 失败", t)
        null
    }

    /**
     * 由 Rust 经 JNI 调用：给出导出中转目录的**绝对路径**（不存在则创建）。"""
assert t.count(old) == 1, "stagingDir 注释锚不唯一"
t = t.replace(old, new, 1)

# 补 import
if "import android.provider.DocumentsContract" not in t:
    t = t.replace(
        "import android.content.Intent",
        "import android.content.Intent\nimport android.provider.DocumentsContract",
        1,
    )
if "import org.json.JSONArray" not in t:
    t = t.replace(
        "import android.provider.DocumentsContract",
        "import android.provider.DocumentsContract\nimport org.json.JSONArray\nimport org.json.JSONObject",
        1,
    )

P.write_text(t, encoding="utf-8")
print("✓ HifishifterFs.kt：tree 授权回传 + savedTreeUri + listTreeChildren")
print(f"  DocumentsContract import: {'import android.provider.DocumentsContract' in t}")
print(f"  JSONArray import: {'import org.json.JSONArray' in t}")
