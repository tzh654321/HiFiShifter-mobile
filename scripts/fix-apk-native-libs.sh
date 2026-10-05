#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fix-apk-native-libs.sh —— 把 APK 里被截成 0 字节的原生库换成真文件，重新对齐 + 签名。
#
# 背景（2026-09-22 实测）：`tauri android build` 打包期间会 symlink
# `libbackend_lib.so` / `libc++_shared.so` 进 jniLibs，而**本机 symlink 静默退化成
# 0 字节文件** ⇒ APK 里那两条是空条目（`build-apk.sh §⑧` 会拦住，exit 3）。
# 已有的两层防护：
#   · `build-apk.sh §⑧`      —— 检测并拒绝出厂（先做）
#   · `build.gradle.kts` 的 `HS-NATIVE-LIB-FIX` —— 合并 jniLibs 前补真文件
# 实测后者仍会被"合并之后的一次截断"覆盖，所以再加这层**最终修补**：
# 直接改 APK 条目（真文件取自 cargo target 与 NDK sysroot），然后
#   zipalign -p 4（未压缩 .so 需页对齐，否则 dlopen 拒绝）→ apksigner 重签
#   （改了内容原签名必失效；用标准 debug keystore，与 AGP 的 debug 包一致）。
#
# 用法： bash scripts/fix-apk-native-libs.sh <apk> [abi]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_IN="${1:?用法: $0 <apk> [abi]}"
ABI="${2:-x86_64}"
case "$ABI" in
  x86_64)    TRIPLE="x86_64-linux-android" ;;
  arm64-v8a) TRIPLE="aarch64-linux-android" ;;
  *) echo "不支持的 ABI: $ABI"; exit 2 ;;
esac

NDK="${NDK_HOME:-D:/Android/Sdk/ndk/27.2.12479018}"
TGT="${CARGO_TARGET_DIR:-D:/code/HiFiShifter/hfshifter-target-upstream}/$TRIPLE/debug"
BT="D:/Android/Sdk/build-tools/35.0.0"
KS="/c/Users/tzh/.android/debug.keystore"
PY="C:/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# 中间产物放 D 盘：这里会写两个 ~172 MB 的 apk，而 C 盘常年只剩几百 MB
# （2026-09-22 实测：C 盘剩 197 MB 时构建直接被挤爆）。可用 HS_APK_FIX_DIR 覆盖。
WORK="${HS_APK_FIX_DIR:-D:/Temp/hs-apk-fix}"
mkdir -p "$WORK"
PATCHED="$WORK/patched.apk"
ALIGNED="$WORK/aligned.apk"

echo "▸ 补入真文件"
echo "    libbackend_lib.so ← $TGT/libbackend_lib.so"
echo "    libc++_shared.so  ← $NDK/.../sysroot/usr/lib/$TRIPLE/libc++_shared.so"
echo "    libonnxruntime.so ← $TGT/libonnxruntime.so（若缺则不动）"

"$PY" - "$(cygpath -m "$APK_IN")" "$(cygpath -m "$PATCHED")" "$ABI" "$TGT" "$NDK" "$TRIPLE" <<'PYEOF'
import os, sys, zipfile
apk_in, apk_out, abi, tgt, ndk, triple = sys.argv[1:7]
repl = {
    f"lib/{abi}/libbackend_lib.so": os.path.join(tgt, "libbackend_lib.so"),
    f"lib/{abi}/libc++_shared.so": os.path.join(
        ndk, "toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib", triple, "libc++_shared.so"),
    f"lib/{abi}/libonnxruntime.so": os.path.join(tgt, "libonnxruntime.so"),
}
zin = zipfile.ZipFile(apk_in)
with zipfile.ZipFile(apk_out, "w", zipfile.ZIP_DEFLATED) as zout:
    n_fix = 0
    for item in zin.infolist():
        data = zin.read(item.filename)
        src = repl.get(item.filename)
        # 只替换"空条目"，绝不覆盖正常条目（避免把旧 .so 写进新包）
        if src and os.path.isfile(src) and item.file_size == 0:
            data = open(src, "rb").read()
            n_fix += 1
            print(f"    替换 {item.filename}: 0 → {len(data)/1048576:.1f} MB")
        # .so 必须**不压缩**（Android 要求 extractNativeLibs=false 时按页对齐）
        if item.filename.endswith(".so"):
            zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
            zi.compress_type = zipfile.ZIP_STORED
            zi.external_attr = item.external_attr
            zout.writestr(zi, data)
        else:
            zout.writestr(item, data)
    print(f"    共替换 {n_fix} 条")
    if n_fix == 0:
        print("    （没有空条目，无需修补）")
PYEOF

echo "▸ zipalign -p 4"
"$BT/zipalign.exe" -f -p 4 "$(cygpath -m "$PATCHED")" "$(cygpath -m "$ALIGNED")"

echo "▸ apksigner 重签（debug keystore）"
cp -f "$ALIGNED" "$APK_IN"
"$BT/apksigner.bat" sign --ks "$(cygpath -m "$KS")" \
  --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  "$(cygpath -m "$APK_IN")" >/dev/null

echo "▸ 校验"
"$BT/apksigner.bat" verify "$(cygpath -m "$APK_IN")" | head -3
"$PY" - "$(cygpath -m "$APK_IN")" <<'PYEOF'
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
echo "✅ 修补完成（已重签，可直接 adb install）：$APK_IN"
