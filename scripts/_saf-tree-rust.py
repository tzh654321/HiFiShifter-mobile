#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#8 批 2/3：Rust 侧 —— tree 目录授权、列目录、以及 `list_directory` 的 SAF 回退。

关键设计：**tree URI ↔ 真实路径的映射**
SAF 的 tree URI 形如
    content://com.android.externalstorage.documents/tree/primary%3AHiFiShifter
其中 `primary:HiFiShifter` 是可解析的 ⇒ 能反推出真实路径前缀
`/storage/emulated/0/HiFiShifter`。这样前端继续用**真实路径**当 `currentPath`
（UI 上就是用户熟悉的路径），Rust 在底下判断"这个路径是否落在已授权的 tree 里"，
是则走 SAF、否则走普通 fs —— 上游 `FileBrowserPanel` 一行不用改。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BE = ROOT / "upstream-src" / "backend" / "src-tauri" / "src"

# ── ① saf.rs：新增 tree 相关 API ─────────────────────────────────────────────
sf = BE / "platform" / "saf.rs"
t = sf.read_text(encoding="utf-8")

add = '''
    // ── #8：目录（tree）授权 ─────────────────────────────────────────────────

    /// 已授权的默认目录 tree URI（没授权过返回空串）。
    pub fn saved_tree_uri() -> String {
        with_env(|env| {
            let cls = app_class(env, KOTLIN_CLASS)?;
            let ret = env
                .call_static_method(&cls, "savedTreeUri", "()Ljava/lang/String;", &[])
                .map_err(|e| {
                    let _ = env.exception_clear();
                    format!("调用 savedTreeUri 失败: {e}")
                })?;
            let obj = ret.l().map_err(|e| format!("取返回值失败: {e}"))?;
            if obj.is_null() {
                return Ok(String::new());
            }
            let s = env
                .get_string(&JString::from(obj))
                .map(|v| String::from(v))
                .map_err(|e| {
                    let _ = env.exception_clear();
                    format!("读字符串失败: {e}")
                })?;
            Ok(s)
        })
        .unwrap_or_default()
    }

    /// 弹系统「选择目录」，返回授权的 tree URI（用户取消返回 `None`）。
    pub fn pick_folder() -> Result<Option<String>, String> {
        match request(KIND_TREE, "vnd.android.document/directory", None, DEFAULT_TIMEOUT)? {
            Some(SafOutcome::Path(p)) => Ok(Some(p.display().to_string())),
            // Kotlin 对 KIND_TREE 回传的是 URI（走 Path 分支承载），上面已覆盖；
            // 这里再兜一层 SaveTarget，避免未来改动导致静默丢结果。
            Some(SafOutcome::SaveTarget { uri, .. }) => Ok(Some(uri)),
            None => Ok(None),
        }
    }

    /// 从 tree URI 反推它在真实文件系统里的路径前缀。
    ///
    /// `content://com.android.externalstorage.documents/tree/primary%3AHiFiShifter`
    ///   ⇒ `Some("/storage/emulated/0/HiFiShifter")`
    /// 不是 externalstorage 提供者、或卷名不认识时返回 `None`（调用方退回普通 fs）。
    pub fn tree_real_prefix(tree_uri: &str) -> Option<String> {
        let seg = tree_uri.split("/tree/").nth(1)?;
        let seg = seg.split('?').next().unwrap_or(seg);
        let decoded = percent_decode(seg);
        let (volume, rel) = decoded.split_once(':')?;
        let base = match volume {
            "primary" => "/storage/emulated/0",
            other => {
                // 形如 "1B2C-3D4E" 的 SD 卡卷 ⇒ /storage/<vol>
                if other.len() >= 4 && other.contains('-') {
                    // 需要 &'static 语义：这里拼成 String 再借用
                    let p = format!("/storage/{other}");
                    return if rel.is_empty() { Some(p) } else { Some(format!("{p}/{rel}")) };
                }
                return None;
            }
        };
        Some(if rel.is_empty() {
            base.to_string()
        } else {
            format!("{base}/{rel}")
        })
    }

    /// 列出 tree 下某相对路径的子项，返回 Kotlin 给的 JSON 数组字符串。
    pub fn list_tree_children(tree_uri: &str, rel_path: &str) -> Result<String, String> {
        let (a, b) = (tree_uri.to_string(), rel_path.to_string());
        with_env(|env| {
            let cls = app_class(env, KOTLIN_CLASS)?;
            let ja = env
                .new_string(&a)
                .map_err(|e| format!("new_string(tree) 失败: {e}"))?;
            let jb = env
                .new_string(&b)
                .map_err(|e| format!("new_string(rel) 失败: {e}"))?;
            let ret = env
                .call_static_method(
                    &cls,
                    "listTreeChildren",
                    "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(&ja), JValue::Object(&jb)],
                )
                .map_err(|e| {
                    let _ = env.exception_clear();
                    format!("调用 listTreeChildren 失败: {e}")
                })?;
            let obj = ret.l().map_err(|e| format!("取返回值失败: {e}"))?;
            if obj.is_null() {
                return Ok("[]".to_string());
            }
            let s = env
                .get_string(&JString::from(obj))
                .map(|v| String::from(v))
                .map_err(|e| {
                    let _ = env.exception_clear();
                    format!("读 JSON 失败: {e}")
                })?;
            Ok(s)
        })
    }

    /// 极简 percent-decode（SAF 的 tree URI 里冒号被编成 `%3A`）。
    fn percent_decode(s: &str) -> String {
        let bytes = s.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }
'''

anchor = "    /// 向 Kotlin 要导出中转目录（JNI → `HifishifterFs.stagingDir`）。"
assert t.count(anchor) == 1, "staging_dir 锚不唯一"
t = t.replace(anchor, add.strip() + "\n\n" + anchor, 1)
sf.write_text(t, encoding="utf-8")
print("✓ saf.rs：saved_tree_uri / pick_folder / tree_real_prefix / list_tree_children / percent_decode")

# ── ② file_browser.rs：Android 上优先走 SAF ─────────────────────────────────
fb = BE / "commands" / "file_browser.rs"
t = fb.read_text(encoding="utf-8")
m = re.search(r"pub\(crate\) fn list_directory\(dir_path: String\) -> Result<Vec<FileEntry>, String> \{", t)
assert m, "list_directory 锚不唯一"

helper = '''/// #8：把 SAF 返回的 JSON 转成 `FileEntry`。
///
/// `dir_path` 是**真实路径**（前端一直用它），每个条目的 path 也按真实路径拼，
/// 这样下游（导入音频/工程）拿到的还是普通路径，且落在 tree 内时由 SAF 物化。
#[cfg(target_os = "android")]
fn list_directory_via_saf(dir_path: &str, tree_uri: &str, rel: &str) -> Result<Vec<FileEntry>, String> {
    let json = crate::platform::saf::list_tree_children(tree_uri, rel)?;
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(&json).map_err(|e| format!("解析 SAF 目录列表失败: {e}"))?;
    let base = dir_path.trim_end_matches('/');
    Ok(arr
        .into_iter()
        .filter_map(|v| {
            let name = v.get("name")?.as_str()?.to_string();
            if name.is_empty() {
                return None;
            }
            let is_dir = v.get("isDir").and_then(|b| b.as_bool()).unwrap_or(false);
            let size = v.get("size").and_then(|n| n.as_i64()).filter(|n| *n >= 0);
            let modified = v.get("modified").and_then(|n| n.as_i64()).filter(|n| *n > 0);
            let extension = if is_dir {
                None
            } else {
                std::path::Path::new(&name)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
            };
            Some(FileEntry {
                path: format!("{base}/{name}"),
                name,
                is_dir,
                size,
                extension,
                modified_time: modified,
            })
        })
        .collect())
}

'''
t = t[:m.start()] + helper + t[m.start():]

# 在函数体开头插入 SAF 分支
old_body_start = "pub(crate) fn list_directory(dir_path: String) -> Result<Vec<FileEntry>, String> {"
idx = t.index(old_body_start) + len(old_body_start)
inject = '''
    // #8：Android 上，若这个路径落在**已授权的 tree** 里，就走 SAF 列目录。
    // 否则（未授权 / 非 Android）继续用普通 fs —— 授权之前的行为完全不变。
    #[cfg(target_os = "android")]
    {
        let tree_uri = crate::platform::saf::saved_tree_uri();
        if !tree_uri.is_empty() {
            if let Some(prefix) = crate::platform::saf::tree_real_prefix(&tree_uri) {
                let norm = dir_path.replace('\\\\', "/");
                let norm = norm.trim_end_matches('/');
                if norm == prefix || norm.starts_with(&format!("{prefix}/")) {
                    let rel = norm[prefix.len()..].trim_start_matches('/').to_string();
                    return list_directory_via_saf(norm, &tree_uri, &rel);
                }
            }
        }
    }
'''
t = t[:idx] + inject + t[idx:]
fb.write_text(t, encoding="utf-8")
print("✓ file_browser.rs：list_directory 加 SAF 分支 + list_directory_via_saf")

# ── ③ dialog.rs：pick_folder 从"未实现"改成真实现 ────────────────────────────
dg = BE / "platform" / "dialog.rs"
t = dg.read_text(encoding="utf-8")
old = [l for l in t.splitlines() if "Android 上的「选择目录」还没实现" in l]
old_block = t[t.index("        pub fn pick_folder(self) -> Option<PathBuf> {") :]
end = old_block.index("\n        }\n") + len("\n        }\n")
old_fn = old_block[:end]
new_fn = '''        pub fn pick_folder(self) -> Option<PathBuf> {
            // #8：已实现。返回的是 **tree URI**（不是真实路径）—— Android 11+ 下真实路径
            // 不可读，必须持 URI 走 SAF。`file_browser::list_directory` 会据此反推真实路径前缀，
            // 前端仍然用熟悉的 `/storage/emulated/0/...` 显示。
            match crate::platform::saf::pick_folder() {
                Ok(Some(uri)) => {
                    log::info!("[dialog] 选择目录 → 已授权 {uri}");
                    Some(PathBuf::from(uri))
                }
                Ok(None) => {
                    log::info!("[dialog] 选择目录 → 用户取消");
                    None
                }
                Err(e) => {
                    log::error!("[dialog] 选择目录 → SAF 失败：{e}");
                    None
                }
            }
        }
'''
t = t.replace(old_fn, new_fn, 1)
dg.write_text(t, encoding="utf-8")
print("✓ dialog.rs：pick_folder 实现（返回 tree URI）")
