#!/usr/bin/env bash
# HiFiShifter 安卓移植 · 环境变量（Git Bash 用）
#
#   source scripts/android-env.sh
#
# 所有路径都来自本机**已实测可用**的配置：
#  - SDK / build-tools / adb：重力四子棋项目已经在用（android/tools/build.py）
#  - JDK 17：同上项目验证过「JDK 21 会让 build-tools 的 R8/D8 抛 NPE」，Android
#    工具链必须停在 17（Tauri 官方同样要求 17）
#  - NDK 27.2：本次新装，见 docs/09

# ── JDK 选择 ────────────────────────────────────────────────────────────────
# 硬约束：Android 工具链必须停在 **JDK 17**。
#   · 重力四子棋项目已验证：JDK 21 的 javac 会让 build-tools 34/35 自带的
#     R8/D8 抛匿名内部类 NPE；
#   · Tauri 官方同样要求 17。
# 所以下面**按 major 版本做校验**，绝不误选到 21。
#
# 本机实测存在 3 个 JDK 17（一次性列全的办法：读 IDEA 的
# `%APPDATA%\JetBrains\IntelliJIdea2025.3\options\jdk.table.xml`，
# 里面登记了所有编辑过的 JDK）：
#
#   D:\Download\zulu17.64.17-ca-jdk17.0.18-win_x64  Zulu      17.0.18  ← 补丁最新
#   C:\Users\tzh\.jdks\ms-17.0.18                   Microsoft 17.0.18  （IDEA 代管的）
#   D:\Download\_tools\jdk-17                       Oracle    17.0.2   （最早，四子棋在用）
#
# 优先用补丁号最新的。想指定别的：`HIFISHIFTER_JDK='D:\path\to\jdk17' source scripts/android-env.sh`
_win_to_msys() { printf '%s' "$1" | sed 's|\\|/|g; s|^\([A-Za-z]\):|/\L\1|'; }

_jdk_pick() {
  for cand in \
    "${HIFISHIFTER_JDK:-}" \
    'D:\Download\zulu17.64.17-ca-jdk17.0.18-win_x64' \
    'C:\Users\tzh\.jdks\ms-17.0.18' \
    'D:\Download\_tools\jdk-17' ; do
    [ -n "$cand" ] || continue
    _exe="$(_win_to_msys "$cand")/bin/java.exe"
    [ -x "$_exe" ] || continue
    # 只认 major = 17（字符串里会带 "17.）
    case "$("$_exe" -version 2>&1 | head -1)" in
      *'"17.'*) printf '%s' "$cand"; return 0 ;;
      *) continue ;;
    esac
  done
  return 1
}

if JAVA_HOME="$(_jdk_pick)"; then
  export JAVA_HOME
else
  echo "⚠️  找不到可用的 JDK 17，回退到 D:\\Download\\_tools\\jdk-17" >&2
  export JAVA_HOME='D:\Download\_tools\jdk-17'
fi
export JAVA_BIN="$(cygpath -m "$JAVA_HOME" 2>/dev/null || printf '%s' "$JAVA_HOME" | sed 's|\\|/|g')"

# ── 目录 ────────────────────────────────────────────────────────────────────
export ANDROID_HOME="D:\\Android\\Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME\\ndk\\27.2.12479018"
export ANDROID_NDK_HOME="$NDK_HOME"

# adb 优先用 SDK 里的（与 SDK 版本配套）
export ANDROID_PLATFORM_TOOLS="$ANDROID_HOME\\platform-tools"

# ── PATH ────────────────────────────────────────────────────────────────────
# Git Bash 里要把 Windows 风格路径转成 /d/... 形式才能生效
_cargo_bin="/c/Users/tzh/.cargo/bin"
[ -d "$_cargo_bin" ] && export PATH="$_cargo_bin:$PATH"
export PATH="$(_win_to_msys "$JAVA_HOME")/bin:$PATH"
export PATH="/d/Android/Sdk/platform-tools:$PATH"
export PATH="/d/Android/Sdk/build-tools/35.0.0:$PATH"
unset _cargo_bin

# ── 规避失效的本地代理 ──────────────────────────────────────────────────────
# 本机 HTTP_PROXY/HTTPS_PROXY 指向 127.0.0.1:7892，实测已挂（curl 走它全 000，
# 直连反而 206）。git / cargo / gradle / npm 都会读这两个变量，不屏蔽会全线超时。
# 若你的代理客户端重新开起来了，把下面两行注释掉即可恢复走代理。
export NO_PROXY="*"
export no_proxy="*"
export HTTP_PROXY=""
export HTTPS_PROXY=""
export http_proxy=""
export https_proxy=""

# ── Rust 侧目标 ─────────────────────────────────────────────────────────────
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"

# ── Rust 分发镜像（重要）────────────────────────────────────────────────────
# 本机直连 static.rust-lang.org 被严重限速：实测只有 7.7 KB/s（一个组件下了 16 分钟
# 还没完）。清华 TUNA 镜像实测 **4.29 MB/s**（71 MB 用 16.6 秒）。差了三个数量级。
# crates.io 的镜像配在项目根的 .cargo/config.toml 里。
export RUSTUP_DIST_SERVER="https://mirrors.tuna.tsinghua.edu.cn/rustup"
export RUSTUP_UPDATE_ROOT="https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup"

# ── Gradle（Tauri Android 构建）─────────────────────────────────────────────
# 别把 Gradle 缓存放到 C:（空间紧张）。D: 空间更宽裕。
#
# ⚠️⚠️ 这里必须是 **Windows 形式**（`D:\code\HiFiShifter\gradle-home`），**不能**写 MSYS 形式
# （`/d/code/HiFiShifter/gradle-home`）。原因：tauri-cli 会把这个变量透传给原生程序
# `gradlew.bat`（JVM），而 JVM 不认识 MSYS 路径 —— 实测它被破坏成
# `\d\gradle-home`（盘符冒号丢失），于是 gradle wrapper 打开锁文件时直接：
#
#   java.io.FileNotFoundException:
#     \d\gradle-home\wrapper\dists\gradle-8.14.3-bin\<hash>\gradle-8.14.3-bin.zip.lck
#     (拒绝访问)
#
# 同一个坑适用于所有要传给原生程序的路径变量（`ANDROID_HOME` / `NDK_HOME` 等
# 在本文件里都是 Windows 形式）。**bash 自用的路径请单独转一份**，
# 见 `scripts/build-android.sh` 里的 `sdk_posix()` 与 `to_win()`。
#
# 另一个连带事实：如果 gradle 找不到 dist，wrapper 会去 services.gradle.org
# 下载，而那个源在本机实测 20 秒 0 MB（必然 timeout）。所以要么这个变量指对，
# 要么把 dist 复制进默认的 `~/.gradle`（`scripts/setup-gen-android.sh` 会做）。
export GRADLE_USER_HOME='D:\code\HiFiShifter\gradle-home'

# ── 临时目录指到 D:（别再写爆 C:）────────────────────────────────────────────
# 为什么必须在这里显式导出，而不是"系统里设了就完事"：
#   Windows 给每个进程的环境块是**启动时定型**的 —— 之后改注册表里的用户变量，
#   只有**新启动**的进程（由 Explorer 拉起、且 Explorer 收到了 WM_SETTINGCHANGE）
#   才会拿到新值。已经在跑的 WorkBuddy 进程带着旧副本，它派生的每个命令（含本脚本）
#   看到的 TEMP 仍是 `C:\Users\tzh\AppData\Local\Temp`。
#   ⇒ 实测：用户级 TEMP 早已是 D:，但构建仍一路往 C: 写，直到 C: 剩 0 MB
#     （满了的表现：gradle 报「拒绝访问」、模拟器启动 1 秒静默退出）。
#
# 所以项目侧**自己声明**，不依赖外部状态。要换位置：
#   HIFISHIFTER_TEMP='D:\Somewhere' source scripts/android-env.sh
#
# 🔴🔴 2026-09-22：**不要用 `D:\Temp`** —— 那个目录是 WorkBuddy safe-delete 垫片的工作区
#    （里面就有它的状态目录），保护层会盯着在那底下**新建的临时文件**：
#    实测 gradle 的 `:app:compressUniversalDebugAssets` 稳定失败，`--stacktrace` 拿到
#    真因是 `java.nio.file.AccessDeniedException: D:\Temp\xxxx.tmp`
#    （`com.android.zipflinger.LargeFileSource.writeTo` —— 建完 .tmp 再写就被拒）。
#    这个假象很容易误导：报错只说"任务失败 + 一个 .tmp 路径"，看着像 AGP/空间/junction 的锅，
#    连换 TEMP 都"没用" —— 因为 **gradle daemon 的环境块是启动时定型的**，
#    不先 `./gradlew --stop` 再换，新 TEMP 根本传不进去（这一条也踩过）。
#    换到干净目录（`D:\code\HiFiShifter\hs-tmp`）后同一个 task `BUILD SUCCESSFUL`。
_HFS_TEMP_WIN="${HIFISHIFTER_TEMP:-D:\code\HiFiShifter\hs-tmp}"
_HFS_TEMP_MSYS="$(_win_to_msys "$_HFS_TEMP_WIN")"
mkdir -p "$_HFS_TEMP_MSYS" 2>/dev/null
# 三个都设：TMP/TEMP 给原生程序（gradle/JVM、msbuild、clang），TMPDIR 给 MSYS 系工具
# （Git Bash 的 /tmp 就认它）。
export TEMP="$_HFS_TEMP_WIN"
export TMP="$_HFS_TEMP_WIN"
export TMPDIR="$_HFS_TEMP_MSYS"
unset _HFS_TEMP_WIN _HFS_TEMP_MSYS

# ── AVD 位置（2026-09-22）────────────────────────────────────────────────────
# 用户用 `scripts/move-android-avd.ps1` 把 AVD 从 `C:\Users\<你>\.android\avd` 搬到了
# `D:\android-avd`（释放 C 盘 8.2 GB）。emulator 靠 `ANDROID_AVD_HOME` 找 AVD。
#
# 为什么要在这里再导出一次：那个脚本用的是**用户级环境变量**（setx/SetEnvironmentVariable），
# 而**已在运行的进程读不到新值**（环境块启动时定型）—— 和上面 TEMP 是同一个坑。
# 所以项目侧自己兜底：只在目录真实存在、且调用方没指定时才设，避免把没有 AVD 的机器带偏。
if [ -z "${ANDROID_AVD_HOME:-}" ] && [ -d "/d/android-avd" ]; then
  export ANDROID_AVD_HOME='D:\android-avd'
fi

# ── 自检 ────────────────────────────────────────────────────────────────────
_ok() { printf '  ✅ %s\n' "$1"; }
_bad() { printf '  ❌ %s\n' "$1"; }

echo "── HiFiShifter Android 环境 ──"
_JAVA_EXE="$(_win_to_msys "$JAVA_HOME")/bin/java.exe"
if [ -x "$_JAVA_EXE" ]; then
    v=$("$_JAVA_EXE" -version 2>&1 | head -1)
    case "$v" in
      *'"17.'*) _ok "JDK 17 → $v" ;;
      *)        _bad "JAVA_HOME 不是 JDK 17（会触发 R8/D8 的 NPE）：$v" ;;
    esac
    _ok "JAVA_HOME = $JAVA_HOME"
else
    _bad "JDK 17 缺失：$JAVA_HOME"
fi
unset _JAVA_EXE

[ -d "/d/Android/Sdk/platforms/android-35" ] && _ok "SDK platform 35" || _bad "缺 platforms;android-35"
[ -d "/d/Android/Sdk/build-tools/35.0.0" ]   && _ok "build-tools 35.0.0" || _bad "缺 build-tools;35.0.0"
[ -d "/d/Android/Sdk/build-tools/34.0.0" ]   && _ok "build-tools 34.0.0（重力四子棋在用）" || _bad "缺 build-tools;34.0.0"
[ -d "/d/Android/Sdk/ndk/27.2.12479018" ]    && _ok "NDK 27.2.12479018" || _bad "缺 NDK 27.2（sdkmanager --install \"ndk;27.2.12479018\"）"

# 临时目录必须在 D:（C: 常年只剩几百 MB，构建中间产物会把它写满）
case "$TEMP" in
  [Dd]:*) [ -w "$TMPDIR" ] && _ok "TEMP → $TEMP（不占 C:）" || _bad "TEMP 指向 D: 但不可写：$TEMP" ;;
  *)      _bad "TEMP 仍在 C:（$TEMP）—— 构建会写满 C 盘，检查本文件上方那段" ;;
esac

if [ -x "$ANDROID_HOME/platform-tools/adb.exe" ]; then
    _ok "adb → $("$ANDROID_HOME/platform-tools/adb.exe" version 2>/dev/null | head -1)"
else
    _bad "adb 缺失"
fi

if command -v rustc >/dev/null 2>&1; then
    _ok "rustc → $(rustc --version 2>&1)"
    case "$(rustup target list --installed 2>/dev/null)" in
        *aarch64-linux-android*) _ok "target aarch64-linux-android" ;;
        *) _bad "缺 target：rustup target add aarch64-linux-android" ;;
    esac
else
    _bad "rustc 不在 PATH（装完 Rust 后重开一个终端）"
fi

# tauri CLI：本项目**故意不用** `cargo install tauri-cli`（要源码编译，慢得多），
# 而是用 npm 装的预编译二进制，放在探针工程的 node_modules 里，构建脚本会自己加进 PATH。
_HFS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_TAURI_BIN="$_HFS_ROOT/probes/m0-probe/node_modules/@tauri-apps/cli"
if [ -d "$_TAURI_BIN" ]; then
    _ver="$(node -e "console.log(require('$_TAURI_BIN/package.json').version)" 2>/dev/null || echo '?')"
    printf '  ✅ %s\n' "tauri-cli $_ver（npm 装的，构建脚本会自动加进 PATH）"
elif command -v cargo-tauri >/dev/null 2>&1; then
    _ok "tauri-cli → $(cargo tauri --version 2>/dev/null)"
else
    _bad "缺 tauri-cli：cd probes/m0-probe && npm install"
fi
unset _HFS_ROOT _TAURI_BIN _ver

echo "──────────────────────────────"
