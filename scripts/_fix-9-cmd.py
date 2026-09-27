#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 第三步：Tauri 命令 + 注册 + 前端调用。

## 命令形状

照抄 `commands.rs:218` 的 `open_project_dialog()` —— **同步 fn + 返回 serde_json::Value**。
（它不是长阻塞操作：JNI 调一次 Kotlin 的 getter 而已，不等用户交互。）

## ⚠️ 非 Android 要有 stub

`platform::saf` **整个模块只在 `target_os = "android"` 下存在**（saf.rs 的
`#[cfg(target_os = "android")] mod android_impl`）⇒ 桌面构建下必须走另一条分支，
否则编译不过。

## ⚠️ 文件要追加进补丁

`commands.rs` 是**补丁范围外**的文件（我这边改过）⇒ 按项目硬规矩，
regen 补丁时必须把它一并追加（`regen-patch.sh <patch> -- <file>`），
否则下次重放会丢。memory 里记过这条 🕳️。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
SRC = ROOT / "upstream-src" / "backend" / "src-tauri" / "src"

# ── ① commands.rs 加命令 ─────────────────────────────────────────────────
CMD = SRC / "commands.rs"
t = CMD.read_text(encoding="utf-8")

anchor = "pub fn open_project_dialog() -> serde_json::Value {"
addition = """/// HS-OPEN-WITH-PATCH —— 取一次「用本应用打开」的文件路径。
///
/// 用户在别的应用里对本软件的关联文件点「打开」时，`MainActivity` 会把 URI
/// 物化到 `cacheDir/saf_import/` 并记下来（`HifishifterFs.acceptOpenIntent`）。
/// 前端在启动、以及从后台恢复时各调一次这里；Kotlin 侧**取一次即清**。
///
/// 返回 `{"ok": true, "path": "..."}` 或 `{"ok": true, "path": null}`（没有文件等着）。
pub fn take_pending_open_file() -> serde_json::Value {
    #[cfg(target_os = "android")]
    {
        match crate::platform::saf::take_pending_open_path() {
            Ok(Some(p)) => {
                serde_json::json!({"ok": true, "path": p.display().to_string()})
            }
            Ok(None) => serde_json::json!({"ok": true, "path": null}),
            Err(e) => {
                log::warn!("[open-with] 取关联文件路径失败：{e}");
                serde_json::json!({"ok": false, "error": e})
            }
        }
    }
    // 桌面/其它平台：关联文件由 OS 直接以命令行参数传入，不走这里。
    #[cfg(not(target_os = "android"))]
    {
        serde_json::json!({"ok": true, "path": null})
    }
}

pub fn open_project_dialog() -> serde_json::Value {"""

assert t.count(anchor) == 1, f"① 锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)
CMD.write_text(t, encoding="utf-8")
print("✓ ① commands.rs 加了 take_pending_open_file")

# ── ② lib.rs 注册 ────────────────────────────────────────────────────────
LIB = SRC / "lib.rs"
l = LIB.read_text(encoding="utf-8")
anchor2 = "            commands::open_project_dialog,"
addition2 = ("            commands::take_pending_open_file,\n"
             "            commands::open_project_dialog,")
assert l.count(anchor2) == 1, f"② 锚命中 {l.count(anchor2)}"
l = l.replace(anchor2, addition2, 1)
LIB.write_text(l, encoding="utf-8")
print("✓ ② lib.rs 已注册命令")
