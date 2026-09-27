#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# repack-apk.sh —— 只重跑**打包**（不重编 Rust），并修掉 jniLibs 里的空原生库。
#
# 🔴 为什么需要它（2026-09-22 实测）：
# `tauri android build` 在打包前会把 `libbackend_lib.so` 与 `libc++_shared.so`
# **symlink** 进 `gen/android/app/src/main/jniLibs/<abi>/`，而**本机的 symlink 会静默
# 退化成 0 字节文件**（Node 侧实测：`fs.symlinkSync` 不抛错但 `isSymbolicLink()===false`）。
# 后果：gradle 把两个空文件收进 APK，构建**仍然 exit 0 / 打印 "Finished 1 APK"**，
# 而装上后必崩：
#     UnsatisfiedLinkError: dlopen failed: "...!/lib/x86_64/libbackend_lib.so"
#     has bad ELF magic: 504b0304
# 这一步在**每次构建**都会发生（日志里 tauri 的 "symlinking lib" 出现两轮），
# 所以 `build-apk.sh` 的 §⑧ 校验会把产物判为无效 —— 那时用本脚本快速恢复：
# 修 jniLibs → 只跑 `:app:assembleUniversalDebug`（≈1–2 分钟，不重编 Rust）→ 再校验。
#
# ⚠️ 关于"不要绕过构建脚本直接跑 gradlew"（见 memory/MEMORY.md）：
# 那条禁令的**原因是** `gradlew.bat` 那层 shell 没有 source `android-env.sh`，
# 于是会用 PATH 上的 JDK 21，留下 JDK 21 建的 Kotlin classpath 快照，
# 之后正规的 JDK 17 构建再也删不掉它。**本脚本第一件事就是 source android-env.sh**，
# 因此不触发那个陷阱 —— 但仍然**只在 `build-apk.sh` 报 §⑧ 校验失败时用它**，
# 日常构建一律走 `build-apk.sh`。
#
# 用法： bash scripts/repack-apk.sh [abi]      # 默认 x86_64
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/android-env.sh" >/dev/null 2>&1 || true

ABI="${1:-x86_64}"
case "$ABI" in
  x86_64)  TRIPLE="x86_64-linux-android" ;;
  arm64-v8a) TRIPLE="aarch64-linux-android" ;;
  *) echo "不支持的 ABI: $ABI（x86_64 / arm64-v8a）"; exit 2 ;;
esac

SRC_WIN="$(cygpath -m "$ROOT/upstream-src")"
GEN="$ROOT/upstream-src/backend/src-tauri/gen/android"
JNI="$GEN/app/src/main/jniLibs/$ABI"
NDK="${NDK_HOME:-D:/Android/Sdk/ndk/27.2.12479018}"
NDK_CPP="$NDK/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$TRIPLE/libc++_shared.so"
TGT="${CARGO_TARGET_DIR:-D:/hfshifter-target-upstream}/$TRIPLE/debug"

echo "▸ ABI=$ABI  TRIPLE=$TRIPLE"
echo "▸ JAVA_HOME=${JAVA_HOME:-（未设！）}"

# ── ① 修 jniLibs：把真文件补回去 ─────────────────────────────────────────────
echo
echo "▸ ① 修 jniLibs 里的原生库"
[ -f "$TGT/libbackend_lib.so" ] || { echo "❌ 找不到 $TGT/libbackend_lib.so —— 先跑 build-apk.sh"; exit 3; }
[ -f "$NDK_CPP" ]              || { echo "❌ 找不到 NDK 的 libc++_shared.so: $NDK_CPP"; exit 3; }
cp -f "$TGT/libbackend_lib.so" "$JNI/libbackend_lib.so"
cp -f "$NDK_CPP"               "$JNI/libc++_shared.so"
for f in libbackend_lib.so libc++_shared.so libonnxruntime.so libSoundTouchDLL.so; do
  if [ ! -f "$JNI/$f" ]; then echo "  ✗ 缺 $f"; exit 3; fi
  sz=$(wc -c < "$JNI/$f")
  magic=$(head -c 4 "$JNI/$f" | od -An -c | tr -d ' \n')
  if [ "$sz" -gt 0 ] && [ "$magic" = "177ELF" ]; then
    printf "  ✓ %-22s %10s bytes  ELF\n" "$f" "$sz"
  else
    printf "  ✗ %-22s %10s bytes  magic=%s\n" "$f" "$sz" "$magic"; exit 3
  fi
done

# ── ② 只跑打包任务 ───────────────────────────────────────────────────────────
echo
echo "▸ ② gradle :app:assembleUniversalDebug（不重编 Rust）"
cd "$GEN"
./gradlew.bat --project-dir "$(cygpath -m "$GEN")" :app:assembleUniversalDebug "$@" 2>&1 | tail -6 || {
  echo "❌ gradle 打包失败"; exit 4;
}

# ── ③ 校验产物 ───────────────────────────────────────────────────────────────
APK_WIN="$SRC_WIN/backend/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
echo
echo "▸ ③ 校验 APK 内原生库"
"C:/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe" - "$APK_WIN" <<'PYEOF'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = 0
for n in sorted(z.namelist()):
    if n.startswith("lib/") and n.endswith(".so"):
        size = z.getinfo(n).file_size
        head = z.read(n)[:4] if size else b""
        ok = size > 0 and head == b"\x7fELF"
        print(f"    {'✓' if ok else '✗'} {size/1048576:8.2f} MB  {n}")
        bad += 0 if ok else 1
sys.exit(3 if bad else 0)
PYEOF

echo
echo "✅ 重打包完成：$APK_WIN"
