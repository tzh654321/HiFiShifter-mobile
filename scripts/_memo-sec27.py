#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㉗ 节：#8 存储目录改用 SAF 的实现。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㉗ #8 存储目录：走 SAF（三层实现）

用户拍板：「**使用 SAF**，软件内文件管理界面默认打开 `/storage/emulated/0/HiFiShifter`」。

### 为什么不能直接写那个路径

Android 11+ 分区存储下，应用用真实路径读 `/storage/emulated/0/` 会 **EACCES**
（`MANAGE_EXTERNAL_STORAGE` 能绕，但商店会拦，用户选了 SAF）。所以必须：
`ACTION_OPEN_DOCUMENT_TREE` 让用户授权一棵子树 ⇒ `takePersistableUriPermission` ⇒
之后用 `DocumentsContract` 列目录/读写。

### 关键设计：**tree URI ↔ 真实路径的映射**（省掉整层改动）

SAF 的 tree URI 是
`content://com.android.externalstorage.documents/tree/primary%3AHiFiShifter`，
其中 `primary:HiFiShifter` 可解析 ⇒ 能**反推真实路径前缀** `/storage/emulated/0/HiFiShifter`。

于是：**前端继续用真实路径当 `currentPath`**（UI 上就是用户熟悉的路径），
Rust 在 `list_directory` 里判断"这个路径是否落在已授权的 tree 里" —— 是则走 SAF，
否则走普通 `fs`（授权之前行为完全不变）。**上游 `FileBrowserPanel` 的导航逻辑一行没改。**

### 三层改动

| 层 | 位置 | 内容 |
| :--- | :--- | :--- |
| Kotlin | `HifishifterFs.kt` | `KIND_TREE` 回传 tree URI + `takePersistableUriPermission` + 存 prefs；新增 `savedTreeUri()` / `listTreeChildren(treeUri, rel)` / `findChildByName()`。**不引 `androidx.documentfile`**，用系统 `DocumentsContract`（API 21+）——少一个依赖少一份打包风险 |
| Rust | `saf.rs` | `saved_tree_uri()` / `pick_folder()` / `list_tree_children()` / **`tree_real_prefix()`**（含极简 `percent_decode`）/ `list_directory_via_saf()` |
| Rust | `file_browser.rs` | `list_directory` 开头插 `#[cfg(target_os = "android")]` 分支：命中已授权 tree ⇒ 走 SAF，否则原样 |
| Rust | `dialog.rs` | `pick_folder` 从"未实现返回 None"改成真实现（返回 tree URI） |
| 前端 | `fileBrowserSlice.ts` | 新增 `DEFAULT_ANDROID_MUSIC_DIR`；`getInitialPath()` 在 Android 上首次返回它 |
| 前端 | `FileBrowserPanel.tsx` | 错误态（读失败=多半未授权）加「授权访问目录」按钮 ⇒ 调 `pickDirectory` ⇒ 成功后**直接重试原路径**（Rust 会自动改走 SAF）|

### 类型对齐（踩了一下）

`FileEntry` 里是 `size: Option<u64>` / `modified_time: Option<f64>`（`#[serde(rename_all="camelCase")]`），
我第一版按 `i64` 构造 ⇒ 编译不过。**照抄现有结构体的字段类型**比凭印象写安全。

### 待验证

⚠️ 还没装机 —— 要确认：
① 首次进文件浏览器 ⇒ 默认显示 `/storage/emulated/0/HiFiShifter` + 授权按钮；
② 授权后目录能列出来（走 SAF）；
③ **授权之前的行为不变**（未命中 tree ⇒ 普通 fs）。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉗ 节已追加")
