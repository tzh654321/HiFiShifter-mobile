#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""保存方向不能把 `*/*` 交给 ACTION_CREATE_DOCUMENT。

用户反馈：**WAV 导出正常**（MIME 是 `audio/*`），**工程保存仍失败**（MIME 落到 `*/*`，
因为工程 exts 里混了 `json`）。差异就在这一个字段上。

`ACTION_CREATE_DOCUMENT` 的 `type` 要求**具体的** MIME；`*/*` 在部分 ROM（ColorOS 实测）
上会导致创建流程异常 → 返回空 data → 我们判成「用户取消」。
导入方向恰恰相反：只有 `*/*` 才能让用户看到所有文件，所以**不能改 mime() 本身**，
必须给保存单独一条映射。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "upstream-src" / "backend" / "src-tauri" / "src" / "platform" / "dialog.rs"
text = P.read_text(encoding="utf-8")

# ① 新增 save_mime()（紧跟 mime() 之后）
anchor = """        fn detail(&self) -> String {
            let mut parts = Vec::new();
            if let Some(t) = &self.title {
                parts.push(format!("title={t:?}"));
"""
new = """        /// 保存方向的 MIME —— **不能直接复用 `mime()`**。
        ///
        /// 🔴 2026-09-23：用户报「工程保存还是已取消，但 WAV 导出没问题」。
        /// 两者的 `save_file` 调用链**完全相同**（同一个 `FileDialog::save_file`），
        /// 唯一差异就是这个字段：
        ///   · WAV 导出  ⇒ exts=[wav]        ⇒ `audio/*`（具体）
        ///   · 工程保存  ⇒ exts=[hshp,hsp,json,zip] ⇒ 落到 `*/*`
        ///
        /// `ACTION_CREATE_DOCUMENT` 的 `type` 要求**具体的** MIME，`*/*` 在部分 ROM
        /// （ColorOS 实测）上会让创建流程异常、回传空 data —— 我们那边就判成了
        /// 「用户取消」。所以保存一律换成 `application/octet-stream` 兜底。
        ///
        /// ⚠️ **不要**改 `mime()` 本身：导入方向恰恰需要 `*/*`，否则用户在选择器里
        /// 看不到自己要的文件（这条在「导入工程时选到 mp3」那次已经验证过）。
        fn save_mime(&self) -> String {
            let m = self.mime();
            if m == "*/*" {
                "application/octet-stream".to_string()
            } else {
                m
            }
        }

""" + anchor
assert text.count(anchor) == 1, "detail 锚不唯一"
text = text.replace(anchor, new, 1)

# ② save_file 改用它
a2 = """            let mime = self.mime();
            let detail = self.detail();
            match crate::platform::saf::save_file(&mime, self.file_name.as_deref()) {"""
b2 = """            let mime = self.save_mime();
            let detail = self.detail();
            log::info!("[dialog] 另存为{detail} → 用 MIME {mime} 发起 CREATE_DOCUMENT");
            match crate::platform::saf::save_file(&mime, self.file_name.as_deref()) {"""
assert text.count(a2) == 1, "save_file 锚不唯一"
text = text.replace(a2, b2, 1)

P.write_text(text, encoding="utf-8")
print("✓ save_mime() 已加入，save_file 改用它")
