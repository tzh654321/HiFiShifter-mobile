#!/usr/bin/env bash
# 把上游 HiFiShifter 的 APK 装到设备并启动，收集日志与截图。
#
# 用法:
#   bash scripts/run-app.sh <emulator|real> [--no-build] [--no-install] \
#                           [--secs N] [--shots 3,10,20,30]
#
#   emulator → x86_64（x86 宿主跑不了 arm64 镜像，见 docs/09 §5.4）
#   real     → aarch64
#
#   --no-install  跳过推送+安装，只启动并取证。用于包已装好（手动装 / 上一轮装过）
#                 或只想重复观察同一次安装的情况。
#
#   --shots  在指定秒数各截一张图（逗号分隔，相对 `am start` 的时刻）。
#            用途：只看最终态会漏掉**启动早期**的问题 —— 白屏、闪退后的残留、
#            首帧布局错乱（然后被重排掩盖）。首启还要把 184 MB 模型拷到私有目录，
#            这段时间的界面才是用户真正会看到的。
#
# 与 run-probe.sh 的区别：那个跑的是**隔离的探针工程**，这个装的是**上游本体**。
#
# 装包与取日志都踩过坑，这里固化成正确姿势：
#   · 不能 `adb install`：ColorOS 把确认交给默认安装器 App，
#     可能卡 4 分钟不返回，甚至撞到 FileProvider 跨 App 权限报错（与我们无关）。
#   · 不能 `pm install /sdcard/...`：/sdcard 是 FUSE，system_server 读不了。
#   · ✅ `adb push /data/local/tmp/` + `pm install -r -t -d`
#   · 日志优先「落盘 + run-as」；logcat 可用但会被话痨进程冲掉环形 buffer。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$ROOT/.setup"
mkdir -p "$SETUP"

PKG="com.arounder.hifishifter"
APK="$ROOT/upstream-src/backend/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"

MODE="${1:-emulator}"; shift || true
BUILD=1; INSTALL=1; SECS=25; SHOTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --no-install) INSTALL=0 ;;
    --secs) shift; SECS="${1:-25}" ;;
    --shots) shift; SHOTS="${1:-}" ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$MODE" in
  emulator) TARGET="x86_64";  ABI="x86_64"    ;;
  real)     TARGET="aarch64"; ABI="arm64-v8a" ;;
  *) echo "用法: $0 <emulator|real> [--no-build] [--secs N]" >&2; exit 2 ;;
esac

. "$ROOT/scripts/android-env.sh" >/dev/null 2>&1 || true
ADB="${ANDROID_HOME}\\platform-tools\\adb.exe"
ADB_BIN="$(cygpath -u "$ANDROID_HOME" 2>/dev/null || printf '%s' "$ANDROID_HOME" | sed 's|\\|/|g')/platform-tools/adb.exe"
[ -x "$ADB_BIN" ] || { echo "❌ 找不到 adb: $ADB_BIN" >&2; exit 1; }

log() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

# 截图助手（函数体内的 SERIAL/ADB_BIN 在调用时才求值，此处只是定义）
SHOT_TAG="app-$MODE-$(date +%H%M%S)"
shot() {  # shot <时间标签> <目标路径>
  "$ADB_BIN" -s "$SERIAL" exec-out screencap -p > "$2" 2>/dev/null
  if [ -s "$2" ]; then
    printf '  ✅ t=%-5s %s (%s 字节)\n' "$1" "$(basename "$2")" "$(stat -c %s "$2")"
  else
    printf '  ⚠️  t=%-5s 截图失败\n' "$1" >&2
  fi
}

# ── 1. 选设备 ───────────────────────────────────────────────────────────────
case "$MODE" in
  emulator) SERIAL="$("$ADB_BIN" devices | awk '$1 ~ /^emulator-/ {print $1; exit}')" ;;
  real)     SERIAL="$("$ADB_BIN" devices | awk '$1 !~ /^emulator-/ && $1 !~ /List/ && NF>1 {print $1; exit}')" ;;
esac
if [ -z "${SERIAL:-}" ]; then
  echo "❌ 没有可用设备（mode=$MODE）。" >&2
  [ "$MODE" = real ] && echo "   插上手机并开 USB 调试。" >&2
  [ "$MODE" = emulator ] && echo "   启动: D:/Android/Sdk/emulator/emulator.exe -avd hs-phone-tall -no-snapshot-load -gpu swiftshader_indirect" >&2
  exit 1
fi
DEV_ABI="$("$ADB_BIN" -s "$SERIAL" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n')"
log "设备 $SERIAL（$DEV_ABI）"
case "$MODE:$DEV_ABI" in
  emulator:x86_64|real:arm64-v8a) : ;;
  *) echo "⚠️  设备 ABI ($DEV_ABI) 与模式 ($MODE → $ABI) 不匹配，装不上。" >&2 ;;
esac

# ── 2. 构建 ─────────────────────────────────────────────────────────────────
if [ "$BUILD" = 1 ]; then
  log "构建 $ABI（setup-gen-android → build-apk）"
  bash "$ROOT/scripts/setup-gen-android.sh" "$ABI" >/dev/null
  BLOG="$SETUP/app-build-$ABI.log"
  ( cd "$ROOT" && bash scripts/build-apk.sh "$ABI" ) > "$BLOG" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "❌ 构建失败（exit=$rc）。错误摘要：" >&2
    grep -nE '^\s*error|error\[|FAILURE|What went wrong|Caused by' "$BLOG" | head -20 >&2
    echo "   完整日志：$BLOG" >&2
    exit $rc
  fi
  echo "✅ 构建完成（日志 $BLOG）"
fi

if [ "$INSTALL" = 1 ]; then
  [ -f "$APK" ] || { echo "❌ 找不到 APK：$APK" >&2; exit 1; }
  echo "   APK: $(du -h "$APK" | cut -f1)"
else
  echo "   （--no-install：用设备上已装的那份）"
fi

# ── 3. 推送 + 安装 ──────────────────────────────────────────────────────────
if [ "$INSTALL" = 1 ]; then
  log "推送（/sdcard 是 FUSE，不能直接给 pm install）"
  APK_WIN="$(cygpath -m "$APK" 2>/dev/null || printf '%s' "$APK")"
  "$ADB_BIN" -s "$SERIAL" push "$APK_WIN" /data/local/tmp/hifishifter.apk 2>&1 | tail -2

  log "安装"
  "$ADB_BIN" -s "$SERIAL" shell settings put global verifier_verify_adb_installs 0 >/dev/null 2>&1
  # ⚠️ 257 MB 的包在 ColorOS 上**第一次可能被瞬时拒绝**（实测：首调失败、
  # 紧接着原样重跑同一条命令就 `Success`）。不重试会误判成"包有问题"，
  # 然后白花十几分钟重新构建。所以这里重试三次。
  _ok=0
  for _try in 1 2 3; do
    _out="$("$ADB_BIN" -s "$SERIAL" shell pm install -r -t -d /data/local/tmp/hifishifter.apk 2>&1 | tr -d '\r')"
    printf '  第 %s 次: %s\n' "$_try" "$(printf '%s' "$_out" | tail -1)"
    case "$_out" in *Success*) _ok=1; break ;; esac
    [ "$_try" -lt 3 ] && sleep 4
  done
  [ "$_ok" = 1 ] || echo "  ⚠️ 三次都没返回 Success（下面还会校验包在不在）" >&2
fi

# 无论本轮装没装，都校验包确实在位。跳过安装时这条是唯一的兜底。
if ! "$ADB_BIN" -s "$SERIAL" shell pm list packages 2>/dev/null | grep -q "$PKG"; then
  echo "❌ 包列表里没有 $PKG" >&2
  [ "$INSTALL" = 1 ] || echo "   用了 --no-install 却没装：先手动装 $APK" >&2
  exit 1
fi

# ── 4. 启动 ─────────────────────────────────────────────────────────────────
RAW="$("$ADB_BIN" -s "$SERIAL" shell cmd package resolve-activity --brief \
        -c android.intent.category.LAUNCHER "$PKG" 2>/dev/null | tr -d '\r')"
COMPONENT="$(printf '%s' "$RAW" | grep -oE '[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+' | tail -1)"
case "$COMPONENT" in /*) COMPONENT="$PKG$COMPONENT" ;; esac

log "启动 ${COMPONENT:-<未解析出>}"
"$ADB_BIN" -s "$SERIAL" logcat -c >/dev/null 2>&1
"$ADB_BIN" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1
if [ -n "${COMPONENT:-}" ] && [ "${COMPONENT#*/}" != "$COMPONENT" ]; then
  "$ADB_BIN" -s "$SERIAL" shell am start -n "$COMPONENT" 2>&1 | tr -d '\r' | tail -2
else
  "$ADB_BIN" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 2>&1 | tail -2
fi

if [ -n "$SHOTS" ]; then
  log "分时截图（抓启动早期：白屏 / 首帧布局 / 提前崩溃）"
  _prev=0
  _n=0
  for _t in $(printf '%s' "$SHOTS" | tr ',' ' '); do
    case "$_t" in ''|*[!0-9]*) continue ;; esac
    [ "$_t" -le "$_prev" ] && continue
    sleep $(( _t - _prev ))
    _prev="$_t"
    _n=$((_n + 1))
    shot "${_t}s" "$SETUP/${SHOT_TAG}-t${_t}s.png"
    # 每一帧都看一眼进程还在不在 —— 崩了就不必再等
    if [ -z "$("$ADB_BIN" -s "$SERIAL" shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')" ]; then
      printf '  ❌ %ss 时进程已不在（启动崩溃）\n' "$_t"
      break
    fi
  done
  [ "$SECS" -gt "$_prev" ] && sleep $(( SECS - _prev ))
else
  echo "   等待 ${SECS} 秒（首启要拷模型到私有目录）..."
  sleep "$SECS"
fi

# ── 5. 结果 ─────────────────────────────────────────────────────────────────
log "进程状态"
PID="$("$ADB_BIN" -s "$SERIAL" shell pidof "$PKG" 2>/dev/null | tr -d '\r\n')"
if [ -n "$PID" ]; then
  echo "  ✅ 存活，pid=$PID"
  "$ADB_BIN" -s "$SERIAL" shell dumpsys meminfo "$PKG" 2>/dev/null | grep -E 'TOTAL|Native Heap' | head -3 | tr -d '\r'
else
  echo "  ❌ 进程不在（大概率启动崩溃）"
fi

log "崩溃 / 链接错误"
"$ADB_BIN" -s "$SERIAL" logcat -d -v brief 2>/dev/null \
  | grep -aiE "$PKG|FATAL|AndroidRuntime|UnsatisfiedLink|dlopen|libc  |signal [0-9]|backtrace" \
  | tail -30

# 应用自己的日志（`platform::logging` 落盘的那份）。
# ⚠️ 上游原本在移动端**没有装 logger**（`logging::init_logging()` 只在 main.rs 调用），
# 我们补了 Android 后端；两条通道并存，其中 logcat 有损（会被话痨进程冲掉），
# 落盘可靠 —— 所以这里优先取落盘。
log "应用日志（落盘 + run-as 取回）"
APP_LOG="$SETUP/app-$MODE-$(date +%H%M%S).applog"
_found=0
for cand in logs/android.log files/logs/android.log android.log; do
  out="$("$ADB_BIN" -s "$SERIAL" exec-out run-as "$PKG" cat "$cand" 2>/dev/null | tr -d '\r')"
  if [ -n "$out" ]; then
    printf '%s\n' "$out" > "$APP_LOG"
    echo "  ✅ $cand → $APP_LOG（$(printf '%s\n' "$out" | wc -l) 行）"
    echo "  ── 最后 25 行 ──"
    printf '%s\n' "$out" | tail -25 | sed 's/^/    /'
    _found=1
    break
  fi
done
if [ "$_found" = 0 ]; then
  echo "  ⚠️ 未找到应用的落盘日志（试过 logs/android.log 等）"
  echo "     手动找：adb -s $SERIAL shell run-as $PKG find . -name '*.log'"
else
  # 错误摘要：上游前端会把异常回灌到后端，同一条会刷很多遍（如 ResizeObserver
  # 反馈环 27.7 条/秒），只有按条数归并才看得出"真正有几类问题"。
  echo "  ── 错误摘要（去重后按条数）──"
  _errs="$SETUP/${SHOT_TAG}-errors.txt"
  grep -o '\[ERROR\][^|]*' "$APP_LOG" 2>/dev/null | sed 's/[[:space:]]*$//' \
    | sort | uniq -c | sort -rn > "$_errs"
  if [ -s "$_errs" ]; then
    head -8 "$_errs" | sed 's/^/    /'
    printf '    （共 %s 条 ERROR，归并后 %s 类 → %s）\n' \
      "$(grep -c '\[ERROR\]' "$APP_LOG")" "$(wc -l < "$_errs")" "$_errs"
  else
    echo "    ✅ 0 条 ERROR"
  fi
fi

LOGOUT="$SETUP/app-$MODE-$(date +%H%M%S).logcat"
"$ADB_BIN" -s "$SERIAL" logcat -d -v time > "$LOGOUT" 2>/dev/null
echo "  完整 logcat → $LOGOUT"

log "截图"
shot "final" "$SETUP/${SHOT_TAG}-final.png"
