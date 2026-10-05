#!/usr/bin/env bash
# 下载并解出 libonnxruntime.so（arm64-v8a / x86_64）。
#
# 为什么需要这一步：`third_party/onnxruntime/<abi>/libonnxruntime.so` 是从
# Maven 上官方 `onnxruntime-android` AAR 里取出来的**预编译二进制**（两个共
# 约 60 MB）。二进制不进仓库（见 .gitignore），所以**克隆之后、构建之前**
# 必须先跑一次本脚本；否则 `sync-native-libs.sh` / `build-apk.sh` 会因为
# 找不到 `third_party/onnxruntime/<abi>/libonnxruntime.so` 而失败。
#
# 出处与版本对齐理由见 `third_party/onnxruntime/SOURCE.txt`
# （ort-sys 2.0.0-rc.13 要求 ONNX Runtime **1.28**）。
#
# 用法：
#   bash scripts/fetch-onnxruntime.sh              # 默认只取构建用到的两个 ABI
#   bash scripts/fetch-onnxruntime.sh --force      # 已有也重新下载
#
# 依赖：curl（或 wget） + unzip；两者都没有时退回 python3 解包。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/third_party/onnxruntime"

VERSION="1.28.0"
COORD="com.microsoft.onnxruntime:onnxruntime-android:$VERSION"
AAR="onnxruntime-android-$VERSION.aar"
URL="https://mirrors.cloud.tencent.com/nexus/repository/maven-public/com/microsoft/onnxruntime/onnxruntime-android/$VERSION/$AAR"

# 只取构建实际用到的两个 ABI（armeabi-v7a / x86 不发布，见 ADR-009）
ABIS=(arm64-v8a x86_64)

# 期望值（用来校验下载物确实是同一份二进制；对不上就报错而不是静默继续）
declare -A WANT_SHA=(
  [arm64-v8a]="f826d8efb03adf0a84f10e7ba408f9d4cd11b0a2ccd8d08aeb0f7451fb50cacc"
  [x86_64]="8a31feb45126d981ffac430bd10bc66cfa1036e0864a9fbd80a94121f3085800"
)
declare -A WANT_SIZE=(
  [arm64-v8a]=28637280
  [x86_64]=34640104
)

FORCE=0
for a in "$@"; do
  if [ "$a" = "--force" ]; then FORCE=1; fi
done

say() { printf '%s\n' "$*"; }

# ── 1. 先看是否都已就位（避免无谓下载）─────────────────────────────────
need=0
for abi in "${ABIS[@]}"; do
  f="$DEST/$abi/libonnxruntime.so"
  if [ -f "$f" ] && [ "$FORCE" = "0" ]; then
    sz=$(wc -c <"$f" | tr -d ' ')
    if [ "$sz" = "${WANT_SIZE[$abi]}" ]; then
      say "OK   已有 $abi/libonnxruntime.so（$sz 字节）"
      continue
    fi
    say "WARN $abi/libonnxruntime.so 大小异常（$sz ≠ ${WANT_SIZE[$abi]}）⇒ 重新下载"
  fi
  need=1
done
if [ "$need" = "0" ]; then
  say "全部就位，无需下载。（想强制重取加 --force）"
  exit 0
fi

# ── 2. 下载 AAR 到临时目录 ────────────────────────────────────────────
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

say "下载 $COORD"
say "  $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 5 --retry-all-errors --retry-delay 3 --http1.1 \
    -o "$TMP/$AAR" "$URL"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$TMP/$AAR" "$URL"
else
  say "错误：找不到 curl 或 wget。" >&2
  exit 1
fi

aar_size=$(wc -c <"$TMP/$AAR" | tr -d ' ')
say "  已下载 $aar_size 字节"
if [ "$aar_size" -lt 1000000 ]; then
  say "错误：下载物过小（$aar_size 字节），多半是镜像返回了错误页。" >&2
  exit 1
fi

# ── 3. 解出各 ABI 的 libonnxruntime.so ────────────────────────────────
for abi in "${ABIS[@]}"; do
  out="$DEST/$abi"
  mkdir -p "$out"

  entered=$(wc -c <"$out/libonnxruntime.so" 2>/dev/null | tr -d ' ' || echo 0)
  if [ "${entered:-0}" = "${WANT_SIZE[$abi]}" ] && [ "$FORCE" = "0" ]; then
    continue
  fi

  # ⚠️ 先解到**临时文件**，校验通过才落位 —— 否则校验失败会把原来那份好的覆盖成坏的。
  stage="$out/.libonnxruntime.so.staging"
  rm -f "$stage"

  # AAR 就是 zip，so 在 jni/<abi>/ 下（有些版本在 lib/<abi>/，两种都试）
  member=""
  if command -v unzip >/dev/null 2>&1; then
    if unzip -l "$TMP/$AAR" 2>/dev/null | grep -q "jni/$abi/libonnxruntime.so"; then
      member="jni/$abi/libonnxruntime.so"
    elif unzip -l "$TMP/$AAR" 2>/dev/null | grep -q "lib/$abi/libonnxruntime.so"; then
      member="lib/$abi/libonnxruntime.so"
    fi
    if [ -n "$member" ]; then
      unzip -p "$TMP/$AAR" "$member" >"$stage"
    fi
  fi

  if [ ! -s "$stage" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$TMP/$AAR" "$abi" "$stage" <<'PY'
import sys, zipfile
aar, abi, dest = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(aar) as z:
    for cand in ("jni/%s/libonnxruntime.so" % abi, "lib/%s/libonnxruntime.so" % abi):
        try:
            with z.open(cand) as src, open(dest, "wb") as f:
                f.write(src.read())
            break
        except KeyError:
            continue
    else:
        raise SystemExit("AAR 里找不到 %s 的 libonnxruntime.so" % abi)
PY
  fi

  if [ ! -s "$stage" ]; then
    say "错误：无法从 AAR 解出 $abi/libonnxruntime.so（缺 unzip 且 python3 也失败？）" >&2
    rm -f "$stage"
    exit 1
  fi

  got_size=$(wc -c <"$stage" | tr -d ' ')
  got_sha=$(sha256sum "$stage" | cut -d' ' -f1)
  if [ "$got_size" != "${WANT_SIZE[$abi]}" ] || [ "$got_sha" != "${WANT_SHA[$abi]}" ]; then
    say "错误：下载到的 $abi/libonnxruntime.so 与期望不符（**未落位**，原有文件保持不动）。" >&2
    say "  size: 实际 $got_size / 期望 ${WANT_SIZE[$abi]}" >&2
    say "  sha256: 实际 $got_sha" >&2
    say "          期望 ${WANT_SHA[$abi]}" >&2
    say "上游可能更新了同一版本号的制品；确认无误后再更新本脚本里的期望值。" >&2
    rm -f "$stage"
    exit 1
  fi
  mv -f "$stage" "$out/libonnxruntime.so"
  say "OK   $abi/libonnxruntime.so  ($got_size 字节, sha256 校验通过)"
done

say "完成。接着可以跑 bash scripts/build-apk.sh arm64-v8a"
