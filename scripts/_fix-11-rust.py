#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#11 双开复制 —— Rust 侧。

## 设计

Android 走**文本信封**（`HIFISHIFTER_CLIPBOARD_V1:<base64>`），复用上游现成的
`decode_text_envelope`；写方向补一个 `encode_text_envelope`。

调用 Kotlin：`HifishifterFs.setClipboardText(String): Boolean` /
`getClipboardText(): String?`，JNI 套路照抄 `platform/saf.rs`
（`with_env` + **`app_class`**，⚠️ 不能用 `find_class`）。

## ⚠️ 必须改三处 stub 的 cfg

原来是 `#[cfg(not(any(windows, macos, linux)))]` ⇒ **Android 会命中 stub**。
要把它改成 `not(any(windows, macos, linux, android))`，否则新分支和 stub 同时存在
⇒ 重复定义，编译不过。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
F = ROOT / "upstream-src" / "backend" / "src-tauri" / "src" / "system_clipboard.rs"
t = F.read_text(encoding="utf-8")

# ── ① 加 encode 辅助 ─────────────────────────────────────────────────────
old1 = """fn decode_text_envelope(text: &str) -> Option<Vec<u8>> {
    let body = text.strip_prefix(TEXT_PREFIX)?;
    base64::engine::general_purpose::STANDARD.decode(body).ok()
}"""
new1 = """fn decode_text_envelope(text: &str) -> Option<Vec<u8>> {
    let body = text.strip_prefix(TEXT_PREFIX)?;
    base64::engine::general_purpose::STANDARD.decode(body).ok()
}

/// #11：反向 —— 把二进制打包成文本信封。
///
/// Android 的系统剪贴板走这条路（`ClipData.newPlainText` 各 ROM 都稳，
/// 不必注册自定义 MIME），而上游**本来就读得懂**这个信封，
/// 所以两个 HiFiShifter 实例之间（乃至旧版本）都能互认。
#[cfg(target_os = "android")]
fn encode_text_envelope(bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!(
        "{}{}",
        TEXT_PREFIX,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}"""
assert t.count(old1) == 1, f"① 锚命中 {t.count(old1)}"
t = t.replace(old1, new1, 1)
print("✓ ① 加了 encode_text_envelope")

# ── ② Android 的 write/read 实现（插在 Unsupported platform 段之前）────
anchor = """// ---------------------------------------------------------------------------
// Unsupported platform
// ---------------------------------------------------------------------------"""

addition = """// ---------------------------------------------------------------------------
// Android（#11：双开 HiFiShifter 互相复制）
// ---------------------------------------------------------------------------

/// Android 的系统剪贴板是**全局**资源（同一用户下所有实例共用，分身/平行空间亦然）
/// ⇒ 只要两边都读写它，两个 HiFiShifter 之间就能互传，不需要额外通道。
#[cfg(target_os = "android")]
mod android_clipboard {
    use jni::objects::{JClass, JObject, JString, JValue};
    use jni::JNIEnv;

    use super::{decode_text_envelope, encode_text_envelope};

    const KOTLIN_CLASS: &str = "com.arounder.hifishifter.HifishifterFs";

    /// 附加到当前线程并借用 JNIEnv。与 `platform/saf.rs` 同款：
    /// 用 `attach_current_thread_permanently`（跑在 tokio worker 上，会被复用，
    /// 用 guard 版析构时会 detach，导致后续 JNI 调用变野指针）。
    fn with_env<F, R>(f: F) -> Result<R, String>
    where
        F: FnOnce(&mut JNIEnv) -> Result<R, String>,
    {
        if !crate::platform::ndk_context::is_ready() {
            return Err("ndk_context 尚未初始化".to_string());
        }
        let ctx = ndk_context::android_context();
        // SAFETY: vm 来自 ndk_context（源自 JNI_OnLoad），进程生命周期内有效。
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("JavaVM::from_raw 失败: {e}"))?;
        let mut env = vm
            .attach_current_thread_permanently()
            .map_err(|e| format!("attach_current_thread 失败: {e}"))?;
        f(&mut env)
    }

    /// ⚠️ 不能用 `env.find_class()`：native 附加的线程只有**系统类加载器**视野，
    /// 找不到 app 的类。借 `Application.getClassLoader()` 再 `loadClass`。
    fn app_class<'local>(env: &mut JNIEnv<'local>, name: &str) -> Result<JClass<'local>, String> {
        let ctx = ndk_context::android_context();
        // SAFETY: context 是 ndk_context 持有的全局引用，不会被我们删除。
        let app = unsafe { JObject::from_raw(ctx.context().cast()) };
        let loader = env
            .call_method(&app, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .map_err(|e| {
                let _ = env.exception_clear();
                format!("getClassLoader 失败: {e}")
            })?
            .l()
            .map_err(|e| format!("取 ClassLoader 失败: {e}"))?;
        let jname = env.new_string(name).map_err(|e| format!("new_string 失败: {e}"))?;
        let cls = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&jname)],
            )
            .map_err(|e| {
                let _ = env.exception_clear();
                format!("loadClass({name}) 失败: {e}")
            })?
            .l()
            .map_err(|e| format!("取 Class 失败: {e}"))?;
        Ok(JClass::from(cls))
    }

    pub fn write(bytes: &[u8], _text_summary: &str) -> Result<(), String> {
        // ⚠️ 用信封而不是 `text_summary`：另一个实例要靠它还原二进制。
        let envelope = encode_text_envelope(bytes);
        with_env(|env| {
            let cls = app_class(env, KOTLIN_CLASS)?;
            let jtext = env
                .new_string(&envelope)
                .map_err(|e| format!("new_string 失败: {e}"))?;
            let ok = env
                .call_static_method(
                    &cls,
                    "setClipboardText",
                    "(Ljava/lang/String;)Z",
                    &[JValue::Object(&jtext)],
                )
                .map_err(|e| {
                    let _ = env.exception_describe();
                    let _ = env.exception_clear();
                    format!("setClipboardText 调用失败: {e}")
                })?
                .z()
                .map_err(|e| format!("取返回值失败: {e}"))?;
            if ok {
                Ok(())
            } else {
                Err("clipboard_write_failed: Kotlin 侧返回 false".to_string())
            }
        })
    }

    pub fn read() -> Result<Option<Vec<u8>>, String> {
        with_env(|env| {
            let cls = app_class(env, KOTLIN_CLASS)?;
            let ret = env
                .call_static_method(&cls, "getClipboardText", "()Ljava/lang/String;", &[])
                .map_err(|e| {
                    let _ = env.exception_describe();
                    let _ = env.exception_clear();
                    format!("getClipboardText 调用失败: {e}")
                })?
                .l()
                .map_err(|e| format!("取返回值失败: {e}"))?;
            if ret.is_null() {
                return Ok(None);
            }
            // ⚠️ JString 只在 env 作用域内有效 ⇒ 当场转 Rust String。
            let s: String = env
                .get_string(&JString::from(ret))
                .map_err(|e| format!("get_string 失败: {e}"))?
                .into();
            Ok(decode_text_envelope(s.trim()))
        })
    }
}

#[cfg(target_os = "android")]
pub fn write_bytes(bytes: &[u8], text_summary: &str) -> Result<(), String> {
    android_clipboard::write(bytes, text_summary)
}

#[cfg(target_os = "android")]
pub fn write_bytes_with_reaper(
    bytes: &[u8],
    text_summary: &str,
    // REAPER 专有格式在 Android 上无意义（REAPER 没有手机版）⇒ 忽略。
    _reaper_bytes: Option<&[u8]>,
) -> Result<(), String> {
    android_clipboard::write(bytes, text_summary)
}

#[cfg(target_os = "android")]
pub fn read_bytes() -> Result<Option<Vec<u8>>, String> {
    android_clipboard::read()
}

// ---------------------------------------------------------------------------
// Unsupported platform
// ---------------------------------------------------------------------------"""

assert t.count(anchor) == 1, f"② 锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)
print("✓ ② 加了 Android 分支")

# ── ③ 三个 stub 的 cfg 排除 android ──────────────────────────────────────
old3 = '#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]'
new3 = '#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux", target_os = "android")))]'
n = t.count(old3)
assert n >= 1, f"③ 锚命中 {n}"
t = t.replace(old3, new3)
print(f"✓ ③ stub 的 cfg 排除 android × {n}")

F.write_text(t, encoding="utf-8")
