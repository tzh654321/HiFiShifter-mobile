#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 dialog.rs 里「另存为还没实现」的分支换成 SAF v2 的真实现。

单独写成文件是因为：SQL 里那段的 old_string 含反引号，而经 bash -c "python -c '...'"
传参时反引号会被 shell 当命令替换执行（实测报 `None: command not found`）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "upstream-src" / "backend" / "src-tauri" / "src" / "platform" / "dialog.rs"

OLD = """        pub fn save_file(self) -> Option<PathBuf> {
            let detail = self.detail();
            log::warn!(
                "[dialog] Android 上的「另存为」还没实现{detail}：\\
                 它是唯一「先处理再写文件」的方向，需要一个「写完了」的时点来把\\
                 cacheDir 里的临时产物上传到用户选的 URI（docs/11 §3.5）。\\
                 本次按「用户取消」返回。"
            );
            None
        }"""

NEW = """        /// 保存（另存为）—— **SAF v2，2026-09-22 起已实现**。
        ///
        /// 之前一直按「未实现」返回 None，用户看到的就是「已取消保存」。
        ///
        /// 方向与导入相反，所以走法也不同：先弹系统「新建文档」拿**目标 URI**，
        /// 再在 cacheDir 里生成一个**中转路径**返回给调用方写（保持上游
        /// 「拿到路径就写」的调用形状不变）；中转文件写稳后由 watcher 自动上传。
        /// 详见 platform::saf 里的 save_file 与 spawn_export_watcher。
        pub fn save_file(self) -> Option<PathBuf> {
            let mime = self.mime();
            let detail = self.detail();
            match crate::platform::saf::save_file(&mime, self.file_name.as_deref()) {
                Ok(Some(path)) => {
                    log::info!(
                        "[dialog] 另存为{detail} → 中转路径 {}（写稳后自动上传）",
                        path.display()
                    );
                    Some(path)
                }
                Ok(None) => {
                    log::info!("[dialog] 另存为{detail} → 用户取消");
                    None
                }
                Err(e) => {
                    // 与导入一致：这不是「取消」，是桥接出问题，用 error 级别留痕。
                    log::error!("[dialog] 另存为{detail} → SAF 失败：{e}");
                    None
                }
            }
        }"""


def main() -> int:
    text = P.read_text(encoding="utf-8")
    n = text.count(OLD)
    if n != 1:
        print(f"✗ 锚出现 {n} 次（应为 1），未改动")
        return 1
    P.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    print("✓ dialog.rs 的 save_file 已换成 SAF v2 实现")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
