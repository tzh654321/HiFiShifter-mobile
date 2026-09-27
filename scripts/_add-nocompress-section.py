#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""往 setup-gen-android.sh 里插 §12：给 app/build.gradle.kts 注入 noCompress。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "scripts" / "setup-gen-android.sh"

ANCHOR = '\necho\necho "── 自检 ──"'

SECTION = r'''
# ── 12. assets 不压缩（HS-NOCOMPRESS-PATCH，2026-09-22）─────────────────────
# 🔴 这是修好「完整构建」的关键一步，别再删掉。
#
# 背景：`:app:compressUniversalDebugAssets` 在本机**稳定失败** —— Zipflinger 会为
# >1 MB 的条目建一个临时文件（`LargeFileSource`），而那个临时文件会被本机的安全层
# 锁住，报 `java.nio.file.AccessDeniedException: …\.tmp`（换临时目录也没用，见
# `android-env.sh` 里 D:\Temp 那段）。assets 里正好躺着一个 54 MB 的
# `pc_nsf_hifigan.onnx`，所以这个 task 只要真跑就必踩 —— 之前几次"成功"都是它命中了
# UP-TO-DATE 缓存而根本没执行。
#
# 让这些条目不参与压缩，task 就没有大文件要中转，临时文件自然不出现。
# 代价：APK 里 onnx 不再被 deflate（159 MB → 163.8 MB），换来**打包稳定** —— 这是
# 改 Kotlin（SAF v2 之类）的前提，因为 Kotlin 改动绕不过完整打包。
echo
echo "── build.gradle.kts：assets 不压缩 ──"
APP_GRADLE="$GEN_DIR/app/build.gradle.kts"
if [ ! -f "$APP_GRADLE" ]; then
  echo "⚠️ 没找到 app/build.gradle.kts，跳过" >&2
elif grep -q 'HS-NOCOMPRESS-PATCH' "$APP_GRADLE"; then
  echo "· 已注入过，跳过"
else
  # 锚在 `android {` 那一行：它在 tauri 模板里必定存在，且在 android 块内部。
  # 只用一行 sed（不放多行注释）—— 注释与原理都写在本脚本 §12 里，改 gradle 只留标记，
  # 既避免 sed 处理多行的转义地狱，也让 gen 目录里的文件一眼能看出是"注入的"。
  sed -i '0,/^android {/s//android {\n    androidResources { noCompress += listOf("onnx", "json") } \/\/ HS-NOCOMPRESS-PATCH/' "$APP_GRADLE"
  if grep -q 'HS-NOCOMPRESS-PATCH' "$APP_GRADLE"; then
    echo "✓ 已注入 noCompress(onnx, json)"
  else
    echo "❌ 注入失败，请手工检查 $APP_GRADLE" >&2
  fi
fi
'''

def main() -> int:
    text = P.read_text(encoding="utf-8")
    if "HS-NOCOMPRESS-PATCH" in text:
        print("· §12 已存在，跳过")
        return 0
    if text.count(ANCHOR) < 1:
        print("✗ 找不到锚（echo 自检）")
        return 1
    # 插在**最后一个** "── 自检 ──" 之前
    idx = text.rfind(ANCHOR)
    text = text[:idx] + "\n" + SECTION + text[idx:]
    P.write_text(text, encoding="utf-8")
    print("✓ §12 已插入 setup-gen-android.sh")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
