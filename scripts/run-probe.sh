#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# M0 探针：构建 → 安装 → 启动 → 收集结果
#
#   ./scripts/run-probe.sh emulator            # x86_64 → AVD（WHPX 加速，日常主力）
#   ./scripts/run-probe.sh real                # aarch64 → 真机（音频/性能的唯一可信环境）
#
# 选项：
#   --no-build     跳过构建，用现成 APK
#   --keep-log     不清 logcat 缓冲
#   --secs N       启动后等待 N 秒再收日志（默认 45；cpal 放音 3s + ort 提交较慢）
#
# 背景（为什么必须分两个 target）：
#   x86_64 宿主上的 Android 模拟器**无法启动 arm64 镜像**（QEMU2 直接 FATAL 拒绝），
#   所以模拟器只能用 x86_64 镜像 + 一份临时的 x86_64 debug 包；
#   发布产物仍严格 arm64-v8a（ADR-009），真机用 aarch64 包。
# ══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$PROJ/probes/m0-probe"
SETUP="$PROJ/.setup"
PKG="com.hifishifter.m0probe"
TAG="PROBE"

MODE="${1:-emulator}"; shift || true
BUILD=1; KEEP_LOG=0; WAIT=45

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --keep-log) KEEP_LOG=1 ;;
    --secs)     shift; WAIT="${1:-45}" ;;
    *) echo "未知参数: $1"; exit 2 ;;
  esac
  shift
done

case "$MODE" in
  emulator) TARGET="x86_64";  ABIFILTER="x86_64"    ;;
  # ⚠️ jniLibs 的子目录名必须是 `arm64-v8a`（Android 的规范名），
  #    写成 `arm64` 会建出一个无效目录、APK 里也就没有这个 ABI。
  real)     TARGET="aarch64"; ABIFILTER="arm64-v8a" ;;
  *) echo "用法: $0 <emulator|real> [--no-build] [--secs N]"; exit 2 ;;
esac

export PATH="/c/Users/tzh/.cargo/bin:/c/Users/tzh/.workbuddy/binaries/node/versions/22.22.2:/d/Android/Sdk/platform-tools:$PATH"
export JAVA_HOME='D:\Download\_tools\jdk-17'          # ⚠️ 必须 JDK 17（见 g4 项目验证）
export ANDROID_HOME='D:\Android\Sdk'
export ANDROID_SDK_ROOT='D:\Android\Sdk'
export NDK_HOME='D:\Android\Sdk\ndk\27.2.12479018'
export ANDROID_NDK_HOME="$NDK_HOME"
export GRADLE_USER_HOME='D:\gradle-home'
export RUSTUP_DIST_SERVER="https://mirrors.tuna.tsinghua.edu.cn/rustup"
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy 2>/dev/null
export NO_PROXY='*'

log() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

# ⚠️ Git Bash 的坑：adb / curl 都是 Windows 程序，**不认 `/c/...` 形式的路径**。
# `adb install /c/Users/...` 会报 "failed to stat ...: No such file or directory"，
# `curl -o /c/Users/...` 会静默写不出文件。统一转成 `C:/...`。
to_win() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1" | sed -E 's|^/([a-zA-Z])/|\1:/|'
  fi
}

# ── 1. 选设备 ────────────────────────────────────────────────────────────────
if [ "$MODE" = "emulator" ]; then
  SERIAL=$(adb devices | awk '$1 ~ /^emulator-/ {print $1; exit}')
else
  SERIAL=$(adb devices | awk '$1 !~ /^emulator-/ && $2 == "device" {print $1; exit}')
fi

if [ -z "${SERIAL:-}" ]; then
  echo "❌ 找不到 $MODE 设备。"
  [ "$MODE" = "emulator" ] && echo "   启动： D:/Android/Sdk/emulator/emulator.exe -avd hs-phone-tall -no-snapshot-load -no-boot-anim -gpu swiftshader_indirect"
  [ "$MODE" = "real" ]     && echo "   真机：插 USB 并确认已开「USB 调试」，然后 adb devices 看有没有出现"
  adb devices -l
  exit 1
fi

DEV_ABI=$(adb -s "$SERIAL" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n')
echo "设备      : $SERIAL"
echo "设备 ABI  : $DEV_ABI"
echo "包        : $PKG"
echo "构建 target: $TARGET"

if [ "$MODE" = "real" ] && [ "$DEV_ABI" != "arm64-v8a" ]; then
  echo "⚠️  真机 ABI 是 $DEV_ABI，与 arm64 包不匹配"; exit 1
fi

# ── 2. 构建 ──────────────────────────────────────────────────────────────────
if [ "$BUILD" = 1 ]; then
  # 原生库要在打包前就位（gen/ 是生成物，所以真身在 third_party/）
  log "同步原生库（libonnxruntime.so）"
  bash "$PROJ/scripts/sync-native-libs.sh" "$PROBE/src-tauri" "$ABIFILTER" || exit 1

  log "构建 $TARGET debug APK（首次约 10–20 分钟；增量约 1–2 分钟）"
  mkdir -p "$SETUP"
  BLOG="$SETUP/probe-build-$TARGET.log"
  ( cd "$PROBE" && npx tauri android build --debug --target "$TARGET" --apk ) > "$BLOG" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "❌ 构建失败（exit=$rc）。错误摘要："
    grep -nE '^error|error\[|^error:|FAILURE|Caused by|What went wrong' "$BLOG" | head -30
    echo "   完整日志：$BLOG"
    exit $rc
  fi
  echo "✅ 构建完成（日志 $BLOG）"
fi

# ── 2.5 守卫：检查 .so 里有没有「未定义的 ONNX Runtime 符号」 ────────────────
# 背景（真踩过）：`load-dynamic` 模式下，**任何**对 `ort::sys::Ort*` 的直接引用
# 都会在 libm0_probe_lib.so 里留一个未定义符号，导致 dlopen 失败、
# App 在我们的代码跑起来之前就崩：
#   dlopen failed: cannot locate symbol "OrtGetApiBase" ... → UnsatisfiedLinkError
# 所以构建后必查一次，别让这种包流到设备上。
SO="/d/hfshifter-target/$TARGET-linux-android/debug/libm0_probe_lib.so"
READELF="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe"
if [ -f "$SO" ] && [ -x "$READELF" ]; then
  BAD=$("$READELF" -sW "$SO" 2>/dev/null | grep -E 'UND' | grep -E '\bOrt[A-Za-z0-9_]*\b' || true)
  if [ -n "$BAD" ]; then
    echo "❌ .so 里有未定义的 ONNX Runtime 符号（真机上 dlopen 会直接失败）："
    echo "$BAD" | head -10
    echo "   → 检查是否直接引用了 ort::sys::* 的函数/静态量；"
    echo "     必须走 ort::api() / ort::info()（内部用 ortsys! 宏做运行时解析）。"
    exit 1
  fi
  echo "✅ .so 无未定义 ORT 符号"
fi

# ── 3. 找 APK ────────────────────────────────────────────────────────────────
APK=$(find "$PROBE/src-tauri/gen/android/app/build/outputs/apk" -name '*.apk' -newermt '-1 day' 2>/dev/null | head -1)
[ -z "$APK" ] && APK=$(find "$PROBE/src-tauri/gen/android/app/build/outputs/apk" -name '*'"$ABIFILTER"'*.apk' 2>/dev/null | head -1)
[ -z "$APK" ] && APK=$(find "$PROBE/src-tauri/gen/android/app/build/outputs/apk" -name '*.apk' 2>/dev/null | head -1)
if [ -z "$APK" ]; then echo "❌ 没找到 APK"; exit 1; fi
echo "APK       : $APK ($(du -h "$APK" | cut -f1))"

# ── 4. 安装 + 启动 ───────────────────────────────────────────────────────────
# ⚠️ 安装姿势在国产 ROM 上很讲究，这里走「push 到 /data/local/tmp + pm install」：
#
#   ① `adb install <apk>` 在 ColorOS 上会**卡在手机侧确认流程**（实测 4 分钟不返回），
#      因为 ROM 把确认交给了默认安装器 App（如 InstallerX），而那个 App 又读不到
#      系统安装器 com.android.packageinstaller 的 FileProvider（未导出）：
#        Permission Denial: opening provider androidx.core.content.FileProvider
#        ... that is not exported from UID 10212
#      注意：**这个报错与我们的 APK 无关**，是安装器 App 与 ROM 之间的冲突。
#
#   ② `pm install /sdcard/xxx.apk` 必失败 —— /sdcard 是 FUSE 存储，system_server 读不了：
#        System server has no access to read file context u:object_r:fuse:s0
#        Error: Can't open file: /sdcard/...      Consider using a file under /data/local/tmp/
#
#   ③ 正确姿势：push 到 /data/local/tmp（不经过任何安装器 App，也不受 FUSE 限制）
#      `adb push` 实测 97 MB/s，175 MB 的包 1.8 秒传完。
log "安装"
TMP_APK="/data/local/tmp/${PKG##*.}.apk"
adb -s "$SERIAL" push "$(to_win "$APK")" "$TMP_APK" 2>&1 | tail -2

# 关掉 ADB 安装校验，避免 ROM 弹确认（部分 ROM 上这一步就能让安装静默完成）
adb -s "$SERIAL" shell settings put global verifier_verify_adb_installs 0 2>/dev/null

INSTALL_OUT=$(adb -s "$SERIAL" shell pm install -r -t -d "$TMP_APK" 2>&1 | tr -d '\r')
echo "$INSTALL_OUT" | tail -3

# 校验真的装上了（装失败时后面的 am start 会报 "Activity class does not exist"，
# 那个错误很有误导性，所以这里显式挡一下）
if ! adb -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q "$PKG"; then
  echo "❌ 安装失败：$PKG 不在已安装列表里"
  echo "   pm install 输出：$INSTALL_OUT"
  echo "   退路：把 APK 推到 /sdcard/Download/ 用文件管理器装（会走 ROM 的安装器 App）："
  echo "     adb -s $SERIAL push \"$(to_win "$APK")\" /sdcard/Download/"
  exit 1
fi
echo "✅ 已安装" 

# 不硬编码 Activity 名 —— 从系统里解析 launcher activity。
# ⚠️ 两个坑：
#   1. 只 `tr -d '\r'`，**不能连 `\n` 一起删** —— 否则会把上一行末尾的
#      `isDefault=false` 和组件名粘成一个 `falsecom.xxx/.Main` 的鬼东西。
#   2. 某些系统上 `--brief` 不生效，会打印整段 ResolveInfo 字段，
#      所以用 `^组件/组件` 逐行锚定抽取。
RAW=$(adb -s "$SERIAL" shell cmd package resolve-activity --brief \
        -c android.intent.category.LAUNCHER "$PKG" 2>/dev/null | tr -d '\r')
COMPONENT=$(printf '%s\n' "$RAW" | grep -oE '^[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+' | tail -1)
# 形如 "/.MainActivity" 时补上包名
case "$COMPONENT" in
  /*) COMPONENT="$PKG$COMPONENT" ;;
esac
echo "launcher activity: ${COMPONENT:-<未解析出>}"

if [ "$KEEP_LOG" = 0 ]; then adb -s "$SERIAL" logcat -c 2>/dev/null; fi

log "启动"
adb -s "$SERIAL" shell am force-stop "$PKG" 2>/dev/null
if [ -n "$COMPONENT" ]; then
  adb -s "$SERIAL" shell am start -n "$COMPONENT" 2>&1 | tail -2
else
  echo "（解析失败，退回 monkey 启动）"
  adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 2>&1 | tail -2
fi

log "等待 ${WAIT}s（探针在 app 内自动跑）"
sleep "$WAIT"

# ── 5. 收集（三通道，按可靠性排序）──────────────────────────────────────────
#
# 实测教训：**ColorOS 上 logcat 拿不到应用侧日志** ——
# `adb logcat -s PROBE:V` 返回 0 行，连 eprintln 的 RustStdoutStderr 都没有，
# 而同一个包在模拟器上日志一切正常。（`CommonApp-*-<uid>` 那种壳 tag 里
# 只有 ROM 框架自己关于该 App 的日志，不是 App 的输出。）
#
# 所以探针把日志**同时落盘**到 app_data_dir/probe.log，
# 用 `run-as` 直接 cat 出来 —— 一条命令全文，可 grep 可 diff，不需要人肉翻页截图。
OUT="$SETUP/probe-$MODE-$(date +%H%M%S).log"
# ⚠️ Tauri 在 Android 上 `app_data_dir()` 返回的是**数据目录根**（/data/user/0/<pkg>），
# 不是标准的 `files/` 子目录。所以我们落盘在 `<root>/probe.log`，
# 而 `run-as <pkg>` 的 cwd 就是数据目录根 → 相对路径写 `probe.log`。
# 两个都试一遍，兼容未来改动。
REMOTE_LOG="probe.log"

collect_filelog() {
  for cand in probe.log files/probe.log; do
    out=$(adb -s "$SERIAL" exec-out run-as "$PKG" cat "$cand" 2>/dev/null | tr -d '\r')
    if [ -n "$out" ]; then printf '%s\n' "$out"; return 0; fi
  done
  return 1
}

log "收集探针日志 → $OUT"
{
  echo "### device=$SERIAL abi=$DEV_ABI target=$TARGET  $(date '+%F %T')"
  echo "### 通道 A：run-as 读 app_data_dir/probe.log（真机上唯一可靠）"
  collect_filelog
  echo
  echo "### 通道 B：logcat tag=$TAG"
  adb -s "$SERIAL" logcat -d -v time 2>/dev/null | grep -aE "$TAG|Oboe|AAudio|onnxruntime|FATAL|AndroidRuntime" | tail -100
} > "$OUT" 2>&1

# 优先展示落盘通道的内容（它最完整）
A_LINES=$(collect_filelog | wc -l)
if [ "$A_LINES" -gt 0 ]; then
  echo
  echo "═══════════ 探针输出（落盘通道，$A_LINES 行）═══════════"
  collect_filelog
  echo "════════════════════════════════════════"
else
  echo "⚠️  落盘通道为空（run-as 失败，或探针没跑到 init_file_log）。"
  echo "   run-as 自检："
  adb -s "$SERIAL" shell run-as "$PKG" ls -la files/ 2>&1 | head -6
  if grep -qa "$TAG" "$OUT"; then
    echo
    echo "═══════════ 探针输出（logcat 通道）═══════════"
    grep -a "$TAG" "$OUT"
    echo "════════════════════════════════════════"
  else
    echo "⚠️  logcat 也没有 tag=$TAG 的行。排查："
    echo "   · app 是否起来：adb -s $SERIAL shell ps -A | grep ${PKG##*.}"
    echo "   · 崩溃/启动失败："
    adb -s "$SERIAL" logcat -d 2>/dev/null | grep -aE "AndroidRuntime|FATAL|$PKG" | tail -20
    echo "   · 兜底截图：adb -s $SERIAL exec-out screencap -p > $SETUP/probe-$MODE.png"
  fi
fi
echo
echo "完整日志: $OUT"
