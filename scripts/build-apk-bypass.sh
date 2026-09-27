#!/usr/bin/env bash
# build-apk-bypass.sh —— 绕过 tauri-cli 的 panic 拿到可用 APK。
#
# 【为什么需要】
# `tauri android build` 在 `crates/tauri-cli/src/mobile/mod.rs:403` 会建一个
# WebSocket client，连不上就 panic：
#
#     failed to read CLI options: Context("failed to build WebSocket client",
#         ConnectionRefused: "由于目标计算机积极拒绝，无法连接。")
#
# 之所以以前只有 arm64 撞上：另一个 ABI 的 rust 任务早已 up-to-date、
# **那一步根本不会执行**。一旦清了状态，所有 ABI 都会撞。
#
# 【关键认识】tauri-cli 崩的是**它自己的收尾步骤**，Rust 其实已经编完了
# （日志里能看到 `Finished dev profile in 39s`）。所以：
#
#   build-apk.sh <abi>   →  Rust 编好 + tauri 崩  ⇒ 这是**预期**的
#   gradlew ... -x rust* →  只做打包，跳过那条会崩的路径  ⇒ 拿到 APK
#
# ⚠️ 前端（frontend/dist）由 tauri 的 beforeBuildCommand 在**第一步**就跑完，
#    且被 cargo 嵌进 `libbackend_lib.so` ⇒ 所以两段都必须走，缺一不可。
#    曾试图用裸 `cargo build` 替代第一段，**失败**：缺 tauri 设的 C++ 环境
#    （`fdk-aac-sys` 的 `lpp_tran.cpp` 编译不过）。⇒ 老老实实用 tauri 编。
#
# 【用法】bash scripts/build-apk-bypass.sh [ABI]     # 默认 arm64-v8a
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ABI="${1:-arm64-v8a}"

GEN="upstream-src/backend/src-tauri/gen/android"
APK_REL="app/build/outputs/apk/universal/debug/app-universal-debug.apk"

# ── 第一段：让 tauri 编 Rust（**预期会崩**，但那之前前端已编、Rust 已好）─────
echo "▸ [1/3] 跑 build-apk.sh $ABI（Rust 会编好；tauri 收尾会崩，属预期）…"
set +e
bash scripts/build-apk.sh "$ABI" 2>&1 | tail -6
TAURI_RC=${PIPESTATUS[0]}
set -e
if [ "$TAURI_RC" -eq 0 ]; then
    echo "  ✓ tauri 居然没崩，APK 已直接产出 —— 无需第二段"
else
    echo "  · tauri 退出码 $TAURI_RC（预期）⇒ 进第二段用 gradle 打包"
fi

# ── 第二段：只打包，跳过 4 个 rust 任务 ────────────────────────────────────
# ⚠️ 任务名从报错里抄：不是 armv7/i686，而是 rustBuildArmDebug / rustBuildX86Debug。
echo "▸ [2/3] gradle 打包（-x 掉全部 rust 任务）…"
CLEAN=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "workbuddy/binaries/node" | paste -sd: -)
export PATH="$CLEAN"
: "${ANDROID_HOME:=D:/Android/Sdk}"
: "${ANDROID_SDK_ROOT:=$ANDROID_HOME}"
: "${NDK_HOME:=D:/Android/Sdk/ndk/27.2.12479018}"
export ANDROID_HOME ANDROID_SDK_ROOT NDK_HOME
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

# jniLibs 里每个 .so 必须非空（symlink 有效或真实文件）
case "$ABI" in
    arm64-v8a)   JNI="arm64-v8a"   ;;
    x86_64)      JNI="x86_64"      ;;
    armeabi-v7a) JNI="armeabi-v7a" ;;
    x86)         JNI="x86"         ;;
    *) echo "❌ 不认识的 ABI: $ABI" >&2; exit 1 ;;
esac
JNI_DIR="$GEN/app/src/main/jniLibs/$JNI"
for f in "$JNI_DIR"/*.so; do
    [ -e "$f" ] || { echo "❌ $f 是断链的 symlink" >&2; exit 1; }
    [ "$(wc -c < "$f")" -gt 0 ] || { echo "❌ $f 是 0 字节" >&2; exit 1; }
done
echo "  · jniLibs/$JNI 内 $(ls "$JNI_DIR"/*.so | wc -l) 个 .so 均可读"

(cd "$GEN" && ./gradlew.bat --project-dir . assembleUniversalDebug \
    -x rustBuildArm64Debug \
    -x rustBuildArmDebug \
    -x rustBuildX86Debug \
    -x rustBuildX86_64Debug 2>&1 | tail -6)

# ── 第三段：核验 .so 非空 ELF（等价于 build-apk.sh §⑧）──────────────────
echo "▸ [3/3] 核验 APK 内的 .so…"
: "${PYTHON:=C:/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe}"
"$PYTHON" - "$GEN/$APK_REL" <<'PY'
import sys, zipfile
p = sys.argv[1]
bad = 0
with zipfile.ZipFile(p) as z:
    for i in z.infolist():
        if not i.filename.endswith(".so"):
            continue
        head = z.open(i).read(4)
        ok = head == b"\x7fELF" and i.file_size > 0
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else 'BAD'} {i.filename:44s} {i.file_size:>12,}")
if bad:
    print(f"❌ {bad} 个 .so 不合格", file=sys.stderr)
    sys.exit(1)
PY

echo "✅ 完成：$GEN/$APK_REL"
