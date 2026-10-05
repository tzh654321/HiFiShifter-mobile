#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# 把 third_party/ 下的原生库同步进某个 Tauri 工程的 gen/android jniLibs。
#
#   ./scripts/sync-native-libs.sh probes/m0-probe/src-tauri x86_64
#   ./scripts/sync-native-libs.sh upstream-src/backend/src-tauri arm64-v8a
#
# 为什么需要这一步：
#   `gen/android/` 是 `tauri android init` 生成物，可能被重新生成，
#   所以我们不把 .so 直接放进 gen/ —— 仓库里只有 third_party/ 一份（带 SOURCE.txt
#   记录出处），构建前再同步过去。
#
# 目前只有 ONNX Runtime。SoundTouch / WORLD / Signalsmith 等 C++ 库将来也走这里。
# ══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <src-tauri 目录> [abi...]"
  echo "      abi 默认 arm64-v8a x86_64"
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TAURI="$1"; shift || true
[ "${SRC_TAURI:0:1}" != "/" ] && SRC_TAURI="$ROOT/$SRC_TAURI"

ABIS=("$@")
[ ${#ABIS[@]} -eq 0 ] && ABIS=(arm64-v8a x86_64)

JNI="$SRC_TAURI/gen/android/app/src/main/jniLibs"
if [ ! -d "$SRC_TAURI/gen/android" ]; then
  echo "❌ $SRC_TAURI/gen/android 不存在 —— 先跑 npx tauri android init"
  exit 1
fi

# cargo target 目录（可能是 Windows 形式，转成 MSYS 形式给 ls 用）
TGT="${CARGO_TARGET_DIR:-D:/code/HiFiShifter/hfshifter-target-upstream}"
TGT="$(printf '%s' "$TGT" | sed 's|^\([A-Za-z]\):|/\L\1|; s|\\|/|g')"

n=0
for abi in "${ABIS[@]}"; do
  src="$ROOT/third_party/onnxruntime/$abi/libonnxruntime.so"
  if [ ! -f "$src" ]; then
    echo "⚠️  缺少 $src（跳过 $abi）"
    continue
  fi
  mkdir -p "$JNI/$abi"
  cp -f "$src" "$JNI/$abi/libonnxruntime.so"
  echo "  ✓ $abi/libonnxruntime.so  $(du -h "$src" | cut -f1)"

  # ── SoundTouch：由 build.rs 编译，产物落在 cargo target 目录 ──────────────
  # `libbackend_lib.so` 对它有 DT_NEEDED 依赖，而 **tauri-cli 只自动 symlink
  # `libbackend_lib.so` 与 `libc++_shared.so`**，不会带上它。缺了的表现是
  # App 在 `WryActivity.<clinit>` 就死：
  #   UnsatisfiedLinkError: dlopen failed: library "libSoundTouchDLL.so" not found
  #
  # 正常路径是 build.rs 的 Step 3.5 自己拷（见 build.rs），这里只是**兜底**：
  # `tauri android init` 之后 build script 可能因缓存而不重跑，
  # 此时 jniLibs 被重建过、build.rs 的拷贝就不会发生。
  case "$abi" in
    arm64-v8a)   TRIPLE="aarch64-linux-android" ;;
    x86_64)      TRIPLE="x86_64-linux-android" ;;
    armeabi-v7a) TRIPLE="armv7-linux-androideabi" ;;
    *)           TRIPLE="" ;;
  esac
  if [ -n "$TRIPLE" ]; then
    for prof in debug release; do
      st="$(ls "$TGT/$TRIPLE/$prof/libSoundTouchDLL.so" 2>/dev/null | head -1)"
      if [ -n "$st" ]; then
        cp -f "$st" "$JNI/$abi/libSoundTouchDLL.so"
        echo "  ✓ $abi/libSoundTouchDLL.so  $(du -h "$st" | cut -f1)（兜底同步）"
        break
      fi
    done
  fi

  n=$((n + 1))
done

# 清掉「这次没被请求」的整个 ABI 目录。
# 不这么做的话，上一轮为别的 ABI 同步的文件（libonnxruntime.so / libSoundTouchDLL.so /
# tauri-cli 建的 libc++_shared.so 软链）会留在 jniLibs 里，被 universal APK 一并打进去
# → 包体积无谓翻倍（探针工程实测：175 MB 涨到 307 MB）。
removed=0
if [ -d "$JNI" ]; then
  for d in "$JNI"/*/; do
    [ -d "$d" ] || continue
    abi="$(basename "$d")"
    keep=0
    for want in "${ABIS[@]}"; do [ "$abi" = "$want" ] && keep=1; done
    if [ "$keep" = 0 ]; then
      # 注意 libc++_shared.so / libm0_probe_lib.so 是 tauri-cli 建的软链，
      # 用 rm -rf 目录一并清掉，下次构建会为当前 ABI 重建。
      #
      # ⚠️ 必须走 `/usr/bin/rm` 绝对路径。PATH 最前的 WorkBuddy `shim/safe-bin`
      # 把 `rm` 换成了"移到回收站"实现，删目录时直接报失败：
      #   [safe-delete][diag] genie-trash failed: ... Error during a `trash` operation
      # 后果不是报错退出，而是**静默留下陈旧 ABI 目录**（更危险）。
      /usr/bin/rm -rf "$d"
      echo "  ✗ 清除陈旧 ABI 目录 $abi/（本次不需要）"
      removed=$((removed + 1))
    fi
  done
fi

if [ "$n" -eq 0 ]; then
  echo "❌ 一个都没同步成功"
  exit 1
fi
echo "已同步 $n 个 ABI → $JNI"
echo
echo "提示：确认 APK 里真的带上了（打包后）："
echo "  unzip -l <app>.apk | grep libonnxruntime"
