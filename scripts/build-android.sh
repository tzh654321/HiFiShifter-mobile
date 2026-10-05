#!/usr/bin/env bash
# upstream-src 的 Android 构建入口。
#
# 用法:
#   bash scripts/build-android.sh [ABI] [cargo 子命令与参数...]
#
#   ABI   arm64-v8a（默认，发布用）| x86_64（模拟器调试用）
#
# 例:
#   bash scripts/build-android.sh                    # arm64 + cargo check
#   bash scripts/build-android.sh x86_64 check       # x86_64 + cargo check
#   bash scripts/build-android.sh arm64-v8a build    # arm64 + cargo build
#
# 这个脚本负责三件「上游不知道、但交叉编译必须」的事 —— 全部是**构建参数**，
# 不需要改上游任何一行源码：
#
#   1. cmake 进 PATH
#      SDK 里的 `android.toolchain.cmake` 是给真 cmake 用的。
#      `opusic-sys`（symphonia 的 Opus 解码）与 build.rs 里的 SoundTouch
#      都通过 cmake crate 调用它，本机默认没有 cmake 就会直接
#      `failed to execute command: program not found / is cmake not installed?`
#
#   2. 补 fdk-aac 需要的 `log/log.h`
#      `fdk-aac-sys 0.5.0` 的 `aac/libSBRdec/src/lpp_tran.cpp` 在
#      `#ifdef __ANDROID__` 下无条件 `#include "log/log.h"` —— 那是 AOSP
#      源码树里的路径，**NDK 的 sysroot 只提供 `android/log.h`，没有 log/ 目录**。
#      于是交叉编译直接 fatal error。shim 放在 android/shim/fdk-aac-log/，
#      只通过 -I 注入，不碰任何第三方源码。
#
#   3. 设置 cmake 系 crate 要读的 ANDROID_* 变量
#      否则它们会打一堆 "Unable to find Android env variable ... Hope for good default"
#
# 另外两个约定（见 docs/02）：
#   - `--no-default-features --features onnx` —— 永久排除 Windows 专属的 vslib
#   - target-dir 指到 D:（C: 空间紧张）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src/backend/src-tauri"

ABI="${1:-arm64-v8a}"
if [ $# -gt 0 ]; then shift; fi
if [ $# -eq 0 ]; then set -- check; fi

case "$ABI" in
  arm64-v8a)   TRIPLE="aarch64-linux-android" ;;
  x86_64)      TRIPLE="x86_64-linux-android" ;;
  armeabi-v7a) TRIPLE="armv7-linux-androideabi" ;;
  *)
    echo "错误: 不支持的 ABI '$ABI'（可用: arm64-v8a / x86_64 / armeabi-v7a）" >&2
    exit 2
    ;;
esac

# ── 基础环境：SDK / NDK / JDK17 / 代理清理 / 镜像 / 自检 ────────────────────
# android-env.sh 会在环境不全时报错退出，这是想要的行为。
# shellcheck source=/dev/null
. "$ROOT/scripts/android-env.sh"

# ── MSYS 形式的 SDK 路径 ───────────────────────────────────────────────────
# android-env.sh 把 ANDROID_HOME 设成 **Windows 形式**（`D:\Android\Sdk`），
# 那是给 gradle / cargo 这类原生程序用的；但 bash 的 `test -d` / `ls` 认不了
# 反斜杠路径，所以要转一份 MSYS 形式（`/d/Android/Sdk`）自用。
# 踩过的坑：直接用 "$ANDROID_HOME/cmake/..." 判断会永远为假。
sdk_posix() {
  case "$1" in
    [A-Za-z]:\\*|[A-Za-z]:/*)
      _d="$(printf '%s' "$1" | cut -c1 | tr 'A-Z' 'a-z')"
      _r="$(printf '%s' "$1" | cut -c3- | tr '\\' '/')"
      printf '/%s%s' "$_d" "$_r"
      ;;
    *) printf '%s' "$1" ;;
  esac
}
SDK_POSIX="$(sdk_posix "${ANDROID_HOME:-}")"

# ── ① cmake ────────────────────────────────────────────────────────────────
CMAKE_BIN=""
for cand in "$SDK_POSIX/cmake/3.22.1/bin" "/d/Android/Sdk/cmake/3.22.1/bin" "/c/Android/Sdk/cmake/3.22.1/bin"; do
  if [ -x "$cand/cmake.exe" ]; then
    CMAKE_BIN="$cand"
    break
  fi
done
if [ -n "$CMAKE_BIN" ]; then
  PATH="$CMAKE_BIN:$PATH"
  export PATH
fi
if ! command -v cmake >/dev/null 2>&1; then
  echo "❌ PATH 里没有 cmake（opusic-sys 与 SoundTouch 都要它）。装一个：" >&2
  echo "   sdkmanager --install \"cmake;3.22.1\"" >&2
  exit 1
fi

# ── ② fdk-aac 的 log/log.h shim ────────────────────────────────────────────
SHIM="$ROOT/android/shim/fdk-aac-log"
if [ ! -f "$SHIM/log/log.h" ]; then
  echo "❌ 缺少 $SHIM/log/log.h（fdk-aac 的 Android 编译必需）" >&2
  exit 1
fi

# ⚠️ 关键：塞进 CFLAGS 的路径必须是 **Windows 形式**（`C:/...`）。
# clang.exe 是原生 Windows 程序，**不认 MSYS 路径** `/c/Users/...`。
# 踩过的坑：先前直接传 $ROOT（MSYS 形式），cc-rs 原样拼进命令行后
# clang 静默忽略了那个 -I，于是依旧报 `'log/log.h' file not found`，
# 看起来像"shim 没生效"，其实是路径形式不对。
to_win() {
  case "$1" in
    /[A-Za-z]/*)
      _d="$(printf '%s' "$1" | cut -c2 | tr 'A-Z' 'a-z')"
      _r="$(printf '%s' "$1" | cut -c3-)"
      printf '%s:%s' "$_d" "$_r"
      ;;
    *) printf '%s' "$1" ;;
  esac
}
SHIM_WIN="$(to_win "$SHIM")"

# cc-rs 读 CFLAGS_<target>（target 里的 '-' 换成 '_'）。
# 注意：fdk-aac-sys 的 build.rs 从不调用 cc::Build::cpp(true)，
# 所以即使是 .cpp 文件也走 **CFLAGS** 而不是 CXXFLAGS —— 两个都设上作保险。
TRIPLE_UNDERSCORE="${TRIPLE//-/_}"
export "CFLAGS_${TRIPLE_UNDERSCORE}=-I$SHIM_WIN"
export "CXXFLAGS_${TRIPLE_UNDERSCORE}=-I$SHIM_WIN"

# ── ③ cmake 系 crate 的 ANDROID_* ──────────────────────────────────────────
export ANDROID_PLATFORM="android-${ANDROID_MIN_SDK:-26}"
export ANDROID_NATIVE_API_LEVEL="${ANDROID_MIN_SDK:-26}"
export ANDROID_ABI="$ABI"
export ANDROID_STL="c++_shared"

# ── cargo ──────────────────────────────────────────────────────────────────
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-D:/code/HiFiShifter/hfshifter-target-upstream}"
export CARGO_BUILD_TARGET="$TRIPLE"

cd "$SRC"
echo
echo "▸ ABI=$ABI  TRIPLE=$TRIPLE"
echo "▸ cmake = $(command -v cmake)"
echo "▸ fdk-aac shim = $SHIM_WIN"
echo "▸ ANDROID_PLATFORM=$ANDROID_PLATFORM  ANDROID_STL=$ANDROID_STL"
echo "▸ CARGO_TARGET_DIR=$CARGO_TARGET_DIR"
echo "▸ cargo $* --target $TRIPLE --no-default-features --features onnx"
echo

exec cargo "$@" --target "$TRIPLE" --no-default-features --features onnx
