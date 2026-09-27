#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 第二步：Rust 侧 —— 取「关联文件」的物化路径。

## 落点

`platform/saf.rs` 的 `android_impl` 里加一个 `pub fn take_pending_open_path()`，
照抄同文件 `call_kotlin_request` 的 JNI 套路：

```rust
with_env(|env| {
    let cls = app_class(env, KOTLIN_CLASS)?;          // ⚠️ 不能 find_class()
    let s = env.call_static_method(&cls, "takePendingOpenPath", "()Ljava/lang/String;", &[])?;
    // 返回可能是 null ⇒ 取 JObject 再判空
    ...
})
```

⚠️ 三个已知坑（都在 saf.rs 的注释里写过，这里照抄）：
1. **不能用 `env.find_class()`** —— native 附加线程只有系统类加载器视野；
2. 返回签名用 **`()Ljava/lang/String;`**（对象），**不是** `()V`；
3. JNI 返回的 `JString` 在 `env` 作用域内有效 ⇒ **必须在闭包里就转成 Rust `String`**，
   不能把 `JString` 传出去。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
SAF = ROOT / "upstream-src" / "backend" / "src-tauri" / "src" / "platform" / "saf.rs"
t = SAF.read_text(encoding="utf-8")

anchor = """    // ── Kotlin → Rust ───────────────────────────────────────────────────────"""

addition = """    // ── HS-OPEN-WITH-PATCH：关联文件（其他应用「打开方式」）──────────────────

    /// 取一次「用本应用打开」的文件路径（Kotlin 侧 `acceptOpenIntent` 物化好的）。
    ///
    /// * `Ok(Some(path))` —— 有文件等着导入，`path` 是 cacheDir 里的真实路径；
    /// * `Ok(None)` —— 没有（正常启动，或已经被取过了）。
    ///
    /// Kotlin 侧**取一次即清**（`takePendingOpenPath`），所以前端只在启动/恢复时各调一次。
    pub fn take_pending_open_path() -> Result<Option<PathBuf>, String> {
        with_env(|env| {
            let cls = app_class(env, KOTLIN_CLASS)?;
            let ret = env
                .call_static_method(
                    &cls,
                    "takePendingOpenPath",
                    // ⚠️ 返回对象签名（不是 ()V）；null 表示没有。
                    "()Ljava/lang/String;",
                    &[],
                )
                .map_err(|e| {
                    let _ = env.exception_describe();
                    let _ = env.exception_clear();
                    format!("HifishifterFs.takePendingOpenPath 调用失败: {e}")
                })?
                .l()
                .map_err(|e| format!("取返回值失败: {e}"))?;
            if ret.is_null() {
                return Ok(None);
            }
            // ⚠️ JString 只在 env 作用域内有效 ⇒ 在这里就转成 Rust String。
            let jstr = JString::from(ret);
            let s: String = env
                .get_string(&jstr)
                .map_err(|e| format!("get_string 失败: {e}"))?
                .into();
            if s.trim().is_empty() {
                return Ok(None);
            }
            Ok(Some(PathBuf::from(s)))
        })
    }

    // ── Kotlin → Rust ───────────────────────────────────────────────────────"""

assert t.count(anchor) == 1, f"锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)
SAF.write_text(t, encoding="utf-8")
print("✓ saf.rs 加了 take_pending_open_path")
