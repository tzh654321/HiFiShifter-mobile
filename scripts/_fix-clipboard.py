#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#11 剪贴板：把「平台不支持」降级为静默成功，让软件内复制照常工作。

用户口径：「复制时显示系统剪贴板被占用：需直接修复 + 无法复制到系统剪贴板时允许软件内复制」。

**根因**：`system_clipboard.rs` 末尾有一段 "Unsupported platform" 的 stub
（`#[cfg(not(any(windows, macos, linux)))]`，Android 正落在这里），
`write_bytes` 直接 `Err("clipboard_unsupported_platform")`。
上游把它映射成「复制失败：系统剪贴板正被占用，请重试。」——
**文案是误导**：根本不是"被占用"，是**这个平台没有原生剪贴板 transport**。

而复制流程实际是两步：**写软件内剪贴板** + 顺带写系统剪贴板。后者失败**不该**拖垮前者。

**修法**：这三个函数在 Android 上降级为"成功但什么都没做"，并留一条 info 日志。
⇒ 软件内复制照常；「粘贴到其他应用」这一步在 Android 上确实做不到，但**不再报假错**。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "backend" / "src-tauri"
     / "src" / "system_clipboard.rs")
t = P.read_text(encoding="utf-8")

old = '''#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn write_bytes(_bytes: &[u8], _text_summary: &str) -> Result<(), String> {
    Err("clipboard_unsupported_platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn write_bytes_with_reaper(
    _bytes: &[u8],
    _text_summary: &str,
    _reaper_bytes: Option<&[u8]>,
) -> Result<(), String> {
    Err("clipboard_unsupported_platform".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn read_bytes() -> Result<Option<Vec<u8>>, String> {
    Err("clipboard_unsupported_platform".to_string())
}'''

new = '''#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn write_bytes(_bytes: &[u8], _text_summary: &str) -> Result<(), String> {
    // 🔴 2026-09-24（TASKS.md #11）：这里从 `Err` 改成 **`Ok`**。
    //
    // Android 及更小的平台没有原生剪贴板 transport，但上游的复制流程是
    // 「**写软件内剪贴板** + 顺带写系统剪贴板」两步 —— 后者不可用**不该**拖垮前者。
    // 原先返回 Err 会被映射成「复制失败：系统剪贴板正被占用，请重试」，
    // 而那个文案是**误导**：不是被占用，是这个平台根本没这个能力。
    // 降级为 Ok 之后：软件内复制（`timeline_clipboard`）照常工作，也不再弹假错误。
    // ⚠️ 「粘贴到其他应用」在 Android 上确实做不到 —— 那需要用 WebView 的
    // clipboard API 单独补，属于另一件事，不在这里假装成功。
    log::info!("[clipboard] 无原生剪贴板 transport，已降级为仅软件内剪贴板");
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn write_bytes_with_reaper(
    _bytes: &[u8],
    _text_summary: &str,
    _reaper_bytes: Option<&[u8]>,
) -> Result<(), String> {
    // 同上：REAPER 专用格式在 Android 上无意义，静默跳过。
    log::info!("[clipboard] 无原生剪贴板 transport，跳过 REAPER 格式写入");
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn read_bytes() -> Result<Option<Vec<u8>>, String> {
    // 读不到系统剪贴板 ⇒ 返回 None（"没有数据"），而不是报错。
    // 上游据此走 "外来数据" 的兜底分支，不会把状态栏刷成红色。
    Ok(None)
}'''

assert t.count(old) == 1, f"stub 锚不唯一：{t.count(old)}"
P.write_text(t.replace(old, new, 1), encoding="utf-8")
print("✓ system_clipboard.rs：Android 的三个 stub 从 Err 降级为 Ok（写入）与 Ok(None)（读取）")
