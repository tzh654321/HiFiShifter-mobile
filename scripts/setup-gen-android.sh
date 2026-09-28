#!/usr/bin/env bash
# 把 `tauri android init` 生成的 Gradle 工程改成我们需要的形态。
#
# 用法:
#   bash scripts/setup-gen-android.sh [ABI]
#
# 为什么是脚本而不是补丁：
#   `upstream-src/backend/src-tauri/gen/` 是 **tauri-cli 的生成物**，
#   每次 `tauri android init` 都会整体重写。把它的配置做成可重放的脚本，
#   比塞进补丁稳（补丁一旦与生成物的版本错位就 apply 不上）。
#   所以 `gen/` 已加入 .gitignore，流程是：
#
#     bash scripts/apply-patches.sh          # 源码改动
#     cd upstream-src/backend/src-tauri && tauri android init   # 生成 Gradle 工程
#     bash scripts/setup-gen-android.sh      # 本脚本
#     bash scripts/build-apk.sh              # 构建
#
# 本脚本做的事（全部幂等）：
#   1. minSdk 24 → 26（ADR-011）。tauri-cli 默认写 24。
#      必须与 NDK clang wrapper 的 `-android26` 一致，否则同一份产物里
#      会出现两套 API level（SAF / AAudio 的分支行为都不同）。
#   2. 只保留请求的 ABI（默认 arm64-v8a，ADR-009），少打一份 27 MB 的 libonnxruntime.so。
#   3. 同步 libonnxruntime.so / libSoundTouchDLL.so 到 jniLibs。
#   4. 把 gradle dist 复制进 ~/.gradle（tauri-cli 不传 GRADLE_USER_HOME）。
#   5. 用 shim 替换 gradlew(.bat)，绕开沙箱对 `*.lck` 的写保护。
#   6. 修正 buildSrc/BuildTask.kt 里写错的 tauri CLI 入口。
#   7. 🔴 MainActivity：把系统栏 inset 变成 padding（不做的后果见 §7）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src/backend/src-tauri"
GRADLE="$SRC/gen/android/app/build.gradle.kts"
ABI="${1:-arm64-v8a}"

if [ ! -f "$GRADLE" ]; then
  echo "❌ 找不到 $GRADLE" >&2
  echo "   先跑: cd $SRC && tauri android init" >&2
  exit 1
fi

# ── 1. minSdk 26 ───────────────────────────────────────────────────────────
if grep -q 'minSdk = 24' "$GRADLE"; then
  sed -i 's/minSdk = 24/minSdk = 26/' "$GRADLE"
  echo "✓ minSdk: 24 → 26"
elif grep -q 'minSdk = 26' "$GRADLE"; then
  echo "· minSdk 已是 26，跳过"
else
  echo "⚠️ 没找到 minSdk = 24/26，tauri-cli 可能改了默认值 —— 请手工核对" >&2
  grep -n 'minSdk' "$GRADLE" >&2 || true
fi

# ── 2. abiFilters：只保留请求的那一个 ABI ──────────────────────────────────
# 发布走 arm64-v8a（ADR-009）；本地模拟器调试走 x86_64（x86 宿主机跑不了 arm64 镜像）。
# 所以这里要能**来回切**，不能"已存在就跳过"。
if grep -q 'abiFilters' "$GRADLE"; then
  cur="$(grep -oE 'abiFilters \+= listOf\("[^"]*"\)' "$GRADLE" | head -1 | sed 's/.*"\(.*\)".*/\1/')"
  if [ "$cur" = "$ABI" ]; then
    echo "· abiFilters 已是 $ABI，跳过"
  else
    sed -i "s|abiFilters += listOf(\"[^\"]*\")|abiFilters += listOf(\"$ABI\")|" "$GRADLE"
    echo "✓ abiFilters: $cur → $ABI"
  fi
else
  # 插到 defaultConfig 里的 targetSdk 行之后
  awk -v abi="$ABI" '
    !done && /targetSdk = / {
      print
      print ""
      print "        // 只出单一 ABI（ADR-009）：省掉另一份 libonnxruntime.so（27 MB）与整套 Rust 库。"
      print "        // 模拟器调试用的包走本地临时构建，不进发布产物。"
      print "        ndk {"
      print "            abiFilters += listOf(\"" abi "\")"
      print "        }"
      done = 1
      next
    }
    { print }
  ' "$GRADLE" > "$GRADLE.tmp"
  mv "$GRADLE.tmp" "$GRADLE"
  echo "✓ abiFilters += [\"$ABI\"]"
fi

# ── 2.5 清理 ABI 切换残留（2026-09-19 两次复现后固化）─────────────────────
# x86_64↔arm64 来回切后，intermediates/merged_jni_libs 里残留上一 ABI 的 .so，
# gradle 的 mergeUniversalDebugJniLibFolders 会报 "Unable to delete ... *.so"
# （文件其实没被锁，是 gradle 在 Windows 的删除时序问题；gradlew --stop 也没用，
# /usr/bin/rm 立即可删）。切 ABI 后无条件先删。
MERGED_JNI="$(dirname "$GRADLE")/build/intermediates/merged_jni_libs"
if [ -d "$MERGED_JNI" ]; then
  /usr/bin/rm -rf "$MERGED_JNI" 2>/dev/null || rm -rf "$MERGED_JNI"
  echo "✓ 已清理 ABI 切换残留: intermediates/merged_jni_libs"
fi

# ── 2.6 应用图标（2026-09-24）：与电脑版一致 ────────────────────────────────
# gen/android 是生成物，图标必须能随 setup 重放。从上游桌面图标（icons/icon.png，
# 与 exe 同款）生成各密度 mipmap；无网络依赖，用本机 Pillow。
if [ -f "$SRC/backend/src-tauri/icons/icon.png" ]; then
  PYBIN=""
  for c in "C:/Users/tzh/.workbuddy/binaries/python/envs/default/Scripts/python.exe" python py; do
    if command -v "$c" >/dev/null 2>&1; then PYBIN="$c"; break; fi
  done
  if [ -n "$PYBIN" ]; then
    # ⚠️ 这两个脚本**不吃参数**（源图标/res 路径都硬编码在脚本里），
    # 之前这里多传了两个参数、文件名的下划线还对不上 ⇒ **静默失败**，重放时图标从没重生成。
    if "$PYBIN" "$ROOT/scripts/gen-android-icons.py" \
       && "$PYBIN" "$ROOT/scripts/gen-adaptive-icon-xml.py"; then
      echo "✓ 应用图标已生成为电脑版同款（含自适应 + monochrome）"
    else
      echo "⚠ 图标生成失败（不影响构建，沿用默认图标）"
    fi
  else
    echo "⚠ 未找到 python，跳过图标生成（沿用默认图标）"
  fi
fi

# ── 3. jniLibs ─────────────────────────────────────────────────────────────
echo
bash "$ROOT/scripts/sync-native-libs.sh" "$SRC" "$ABI"

# ── 4. gradle wrapper 的 dist ──────────────────────────────────────────────
# ⚠️ tauri-cli **不会**把 GRADLE_USER_HOME 传给 gradlew。
# 实测：它启动 `gradlew.bat --project-dir <gen/android>` 时的环境变量列表里
# 没有 GRADLE_USER_HOME，所以 gradlew 用的是默认的 `~/.gradle`。
# 那里若没有对应版本的 gradle，wrapper 就会去 services.gradle.org 下载 ——
# 而这个源在本机实测 20 秒 0 MB，必然超时：
#
#   Downloading https://services.gradle.org/distributions/gradle-8.14.3-bin.zip
#   Exception in thread "main": ... failed: timeout
#     Caused by: java.net.SocketTimeoutException: Connect timed out
#
# 对策（本脚本做）：把 GRADLE_USER_HOME 里已经下好的那份 dist 复制进 ~/.gradle。
# 这里**不联网**；找不到可复用的就打印两条出路。
GRADLE_VER="8.14.3"
DIST_TAG="gradle-${GRADLE_VER}-bin"
SRC_DISTS="${GRADLE_USER_HOME:-D:/gradle-home}/wrapper/dists"
# GRADLE_USER_HOME 可能是 Windows 形式
case "$SRC_DISTS" in
  [A-Za-z]:/*|[A-Za-z]:\\*)
    _d="$(printf '%s' "$SRC_DISTS" | cut -c1 | tr 'A-Z' 'a-z')"
    _r="$(printf '%s' "$SRC_DISTS" | cut -c3- | tr '\\' '/')"
    SRC_DISTS="/$_d$_r"
    ;;
esac
DST_BASE="$HOME/.gradle/wrapper/dists/$DIST_TAG"

if ls "$DST_BASE"/*/"$DIST_TAG.zip.ok" >/dev/null 2>&1; then
  echo "· $DIST_TAG 已在 ~/.gradle，跳过"
else
  src_path="$(ls -d "$SRC_DISTS/$DIST_TAG"/*/ 2>/dev/null | head -1 || true)"
  if [ -n "$src_path" ] && [ -f "${src_path}${DIST_TAG}.zip.ok" ]; then
    mkdir -p "$DST_BASE"
    cp -r "$src_path" "$DST_BASE/"
    echo "✓ 复制 $DIST_TAG → ~/.gradle（tauri-cli 不传 GRADLE_USER_HOME）"
  else
    echo "⚠️ 没找到可复用的 $DIST_TAG（查过 $SRC_DISTS）。两条出路：" >&2
    echo "   ① 先跑一次探针的构建（它用 GRADLE_USER_HOME，会把 dist 下到那里）；" >&2
    echo "   ② 或把 gen/android/gradle/wrapper/gradle-wrapper.properties 的" >&2
    echo "      distributionUrl 换成腾讯镜像：" >&2
    echo "      https://mirrors.cloud.tencent.com/gradle/$DIST_TAG.zip" >&2
  fi
fi

# ── 5. gradlew shim：绕开 wrapper 的 `.lck` ────────────────────────────────
# 🔴 本机沙箱对 `*.lck` 锁文件有**写保护**，这会让 gradle-wrapper 永久不可用：
#
#   $ java ... org.gradle.wrapper.GradleWrapperMain
#   Exception in thread "main" java.io.FileNotFoundException:
#     C:\Users\tzh\.gradle\wrapper\dists\gradle-8.14.3-bin\<hash>\gradle-8.14.3-bin.zip.lck
#     (拒绝访问。)
#       at org.gradle.wrapper.ExclusiveFileAccessManager.access(...)
#       at org.gradle.wrapper.Install.createDist(Install.java:48)
#
# 而且那个 `.lck` **连删都删不掉**（`rm` → `Permission denied`），
# 所以「删掉让它重建」这条常规出路也不通。
#
# 用一个小 Java 程序做过对照实验，结论很干净（见 docs/06 §4.6）：
#   · 同一目录里**新建**文件 → 正常（说明不是"禁写这个目录"）
#   · **已存在**的 `.lck`，`RandomAccessFile(f,"rw")` → 拒绝访问
#   · `File.canWrite()` 却返回 **true** ← Java 只查只读属性、不查 ACL，所以会误判
#
# 绕过办法：把 `gradlew` / `gradlew.bat` 换成**直接调用已解压的 Gradle 分发**，
# 完全跳过 wrapper 的 Install 流程（`.lck` / `.zip` / `.ok` 都不再需要）。
echo
echo "── gradlew shim（绕开 *.lck 写保护）──"
GEN_DIR="$SRC/gen/android"
GRADLE_BIN_WIN=""
for base in "D:/gradle-home" "$HOME/.gradle"; do
  hit="$(ls -d "$base/wrapper/dists/$DIST_TAG"/*/"gradle-$GRADLE_VER/bin/gradle.bat" 2>/dev/null | head -1 || true)"
  if [ -n "$hit" ]; then GRADLE_BIN_WIN="$hit"; break; fi
done

if [ -z "$GRADLE_BIN_WIN" ]; then
  echo "⚠️ 没找到已解压的 gradle-$GRADLE_VER，跳过 shim（wrapper 仍会被 .lck 卡住）" >&2
else
  WIN_PATH="$(printf '%s' "$GRADLE_BIN_WIN" | sed 's|/|\\|g')"
  REL="wrapper\\dists\\$DIST_TAG\\$(basename "$(dirname "$(dirname "$(dirname "$GRADLE_BIN_WIN")")")")\\gradle-$GRADLE_VER\\bin\\gradle.bat"

  # ⚠️ 这个 .bat 必须**纯 ASCII**。
  # 踩过：里面写了中文注释 → cmd 用 GBK 解码 UTF-8 字节流 → 解析错位，
  # 报出莫名其妙的 `'dlew-shim]' 不是内部或外部命令`。批处理别放非 ASCII。
  cat > "$GEN_DIR/gradlew.bat" <<BAT
@echo off
rem ---------------------------------------------------------------------------
rem  Local shim: call the extracted Gradle distribution directly, bypassing the
rem  gradle-wrapper "Install" step.
rem  Reason: this sandbox write-protects *.lck files, so the wrapper cannot open
rem  <dist>/gradle-$GRADLE_VER-bin.zip.lck (access denied), and that .lck cannot
rem  even be deleted -> the wrapper is permanently unusable.
rem  IMPORTANT: keep this file ASCII-only. Non-ASCII text in a .bat gets
rem  mis-decoded by the GBK console and breaks batch parsing.
rem  Generated by scripts/setup-gen-android.sh -- do not edit by hand.
rem ---------------------------------------------------------------------------
setlocal
set "GRADLE_BIN=$WIN_PATH"
if not exist "%GRADLE_BIN%" set "GRADLE_BIN=%USERPROFILE%\\.gradle\\$REL"
if not exist "%GRADLE_BIN%" goto gradlew_shim_missing
call "%GRADLE_BIN%" %*
exit /b %ERRORLEVEL%
:gradlew_shim_missing
echo [gradlew-shim] extracted Gradle not found: %GRADLE_BIN% 1>&2
exit /b 1
BAT

  cat > "$GEN_DIR/gradlew" <<SH
#!/bin/sh
# Local shim: call the extracted Gradle distribution directly, skipping the
# wrapper Install step. See gradlew.bat for the reason (*.lck is write-protected).
exec "$(printf '%s' "$GRADLE_BIN_WIN" | sed 's|^\([A-Za-z]\):|/\L\1|; s|\\|/|g; s|\.bat$||')" "\$@"
SH
  chmod +x "$GEN_DIR/gradlew"
  echo "✓ gradlew shim 已写入 → $WIN_PATH"
fi

# ── 6. 修正 buildSrc/BuildTask.kt 的 tauri CLI 调用 ─────────────────────────
# 🔴 `tauri android init` 生成这段 Kotlin 时，把「node 的绝对路径」当成 CLI 入口写了进去：
#
#     val executable = """C:\...\node"""
#     val args = listOf("tauri", "android", "android-studio-script")
#
# 于是 Gradle 实际执行的是 `node tauri android android-studio-script` ——
# **`tauri` 被 Node 当成模块名**，去工作目录（src-tauri/）下解析：
#
#     Error: Cannot find module 'C:\...\upstream-src\backend\src-tauri\tauri'
#     FAILURE: Build failed with an exception.
#
# 根因：我们是从**探针工程**的 node_modules 里跑 tauri-cli 给上游做 init 的，
# tauri-cli 在上游找不到自己的 npm 包，就把 node 的路径当成了入口，
# 却仍按「CLI 脚本」的方式传参。
#
# 修法：把 args 的第一项从模块名 `tauri` 换成 CLI 的**真实 JS 入口**
# `@tauri-apps/cli/tauri.js`（这正是 npm 生成的 `.bin/tauri.cmd` 内部做的事）：
#
#     "%_prog%" "%dp0%\..\@tauri-apps\cli\tauri.js" %*
#
# 路径用 **正斜杠**（`C:/...`）—— Kotlin/Node 都接受，且省掉一层转义。
echo
echo "── 修正 BuildTask.kt 的 tauri CLI 调用 ──"
BT="$(find "$GEN_DIR/buildSrc/src" -name 'BuildTask.kt' -print -quit 2>/dev/null || true)"
TAURI_JS_MSYS="$ROOT/probes/m0-probe/node_modules/@tauri-apps/cli/tauri.js"

if [ -z "$BT" ]; then
  echo "⚠️ 没找到 buildSrc 里的 BuildTask.kt，跳过" >&2
  echo "   （不修的话 Gradle 阶段会报 Cannot find module ...\\tauri）" >&2
elif [ ! -f "$TAURI_JS_MSYS" ]; then
  echo "⚠️ 缺少 $TAURI_JS_MSYS" >&2
  echo "   先在 probes/m0-probe 里跑一次 npm install" >&2
else
  if command -v cygpath >/dev/null 2>&1; then
    TAURI_JS="$(cygpath -m "$TAURI_JS_MSYS")"
  else
    TAURI_JS="$TAURI_JS_MSYS"
  fi
  NODE_EXE="${NODE_EXE:-C:/Users/tzh/.workbuddy/binaries/node/versions/22.22.2/node.exe}"

  sed -i \
    -e "s|^\( *\)val executable = .*|\1val executable = \"$NODE_EXE\";|" \
    -e "s|^\( *\)val args = listOf(\"tauri\", \"android\", \"android-studio-script\").*|\1val args = listOf(\"$TAURI_JS\", \"android\", \"android-studio-script\");|" \
    "$BT"

  echo "✓ BuildTask.kt:"
  grep -n 'val executable\|val args = listOf' "$BT" | sed 's/^/    /'
  if ! grep -q '@tauri-apps/cli/tauri.js' "$BT"; then
    echo "  ⚠️ args 未被替换（tauri-cli 可能改了模板）—— 请人工核对上面的输出" >&2
  fi
fi

# ── 7. MainActivity：把系统栏 inset 变成 padding ────────────────────────────
# 🔴 tauri-cli 的模板只调了 `enableEdgeToEdge()` 就完事 —— 那是给"内容本就该铺满
# 全屏"的 WebView 应用用的。而这是**桌面 UI 直接搬过来**的应用：菜单栏、工具栏、
# 底部状态条每一条都贴着窗口边缘。于是真机上（实测 `dumpsys window`）：
#
#     StatusBar     [0,0 - 1080,120]       ← 40 CSS px，浮在内容之上
#     NavigationBar [0,2244 - 1080,2376]   ← 44 CSS px，浮在内容之上
#     MainActivity  [0,0 - 1080,2376]      ← 整屏、从 y=0 起、零 inset
#
# 结果：菜单栏与系统时钟画在同一行，底部状态条被导航栏压住 ——
# 顶部 40 px / 底部 44 px 的内容既看不见也点不到。模拟器上还不明显，真机必现。
#
# 为什么 padding 能作用到 WebView：wry 是用
# `Activity.setContentView(webview)` 挂载的（`wry/src/android/main_pipe.rs`），
# WebView 正好是 `android.R.id.content` 这个 FrameLayout 的子 View，
# 所以给父容器加 padding 就等于把整个前端视口收缩进安全区。
#
# 顺带处理两件事：
#   · ime —— `enableEdgeToEdge()` 之后框架**不再自动 adjustResize**，
#     不自己垫 inset 的话软键盘会盖住正在编辑的输入框。
#   · 窗口背景 —— API 35+ 会忽略 `SystemBarStyle` 的 scrim 颜色、强制透明系统栏，
#     所以空出来的那条露出的是**窗口背景**（DayNight 主题下浅色模式是白的，
#     在深色应用上就是一条白带）。把它设成应用自己的 `--qt-window`
#     （暗 #353535 / 亮 #f2f3f6），看起来就是顶栏延伸进状态栏。
echo
echo "── MainActivity：系统栏 inset → padding ──"

JAVA_SRC="$GEN_DIR/app/src/main/java"
RES_DIR="$GEN_DIR/app/src/main/res"

# 定位 MainActivity.kt：优先找现成的；找不到就从 build.gradle.kts 的 `namespace` 推导
# 并**新建**（脚本本来就会整体重写它，所以不依赖模板里已存在该文件）。
PKG_FROM_PATH=""
MA="$(find "$JAVA_SRC" -name 'MainActivity.kt' -print -quit 2>/dev/null || true)"
if [ -n "$MA" ]; then
  PKG_FROM_PATH="$(dirname "${MA#"$JAVA_SRC"/}" | tr '/' '.')"
else
  NS="$(grep -oE 'namespace[[:space:]]*=[[:space:]]*"[^"]+"' "$GRADLE" | head -1 | sed 's/.*"\(.*\)"/\1/')"
  if [ -n "$NS" ]; then
    PKG_FROM_PATH="$NS"
    MA="$JAVA_SRC/$(printf '%s' "$NS" | tr '.' '/')/MainActivity.kt"
    mkdir -p "$(dirname "$MA")"
    echo "· MainActivity.kt 不存在，按 namespace=$NS 新建"
  fi
fi

# 应用窗口色：前端 `--qt-window`（index.css）。values = 浅色，values-night = 深色。
# 上游 `AppThemeProvider` 默认跟随 `prefers-color-scheme`，所以这个映射是对齐的。
ensure_chrome_color() {  # ensure_chrome_color <xml> <#RRGGBB>
  local f="$1" v="$2"
  mkdir -p "$(dirname "$f")"
  if [ ! -f "$f" ]; then
    printf '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="hs_chrome">%s</color>\n</resources>\n' "$v" > "$f"
    echo "✓ 新建 $(basename "$(dirname "$f")")/$(basename "$f")  hs_chrome=$v"
  elif grep -q 'name="hs_chrome"' "$f"; then
    sed -i "s|\(<color name=\"hs_chrome\">\)[^<]*\(</color>\)|\1$v\2|" "$f"
    echo "· $(basename "$(dirname "$f")")/$(basename "$f") 已是 hs_chrome=$v"
  else
    sed -i "s|</resources>|    <color name=\"hs_chrome\">$v</color>\n</resources>|" "$f"
    echo "✓ 追加 hs_chrome=$v → $(basename "$(dirname "$f")")/$(basename "$f")"
  fi
}
ensure_chrome_color "$RES_DIR/values/colors.xml"        "#F2F3F6"
ensure_chrome_color "$RES_DIR/values-night/colors.xml"  "#353535"

if [ -z "$MA" ]; then
  echo "⚠️ 没找到 MainActivity.kt 也推导不出 namespace，跳过（顶部 40 px / 底部 44 px 会被系统栏压住）" >&2
else
  if [ -f "$MA" ] && grep -q 'HS-SAFE-AREA-PATCH' "$MA" && grep -q 'HS-SAF-PATCH' "$MA" && grep -q 'HS-RECORD-AUDIO-PATCH' "$MA"; then
    echo "· MainActivity.kt 已打过补丁（$PKG_FROM_PATH），跳过"
  else
    # ⚠️ 必须用**带引号**的 heredoc（<<'KT'）。
    # Kotlin 的 KDoc 里会出现反引号（引用代码标识符），不加引号的话反引号会被
    # shell 当命令替换执行 —— 实测那段 `tauri android init` 真的被当命令跑了一次
    # （报 `tauri: command not found`），而且它所在的那段文字被替换成了空。
    # 包名因此改用占位符 + sed 代入。
    cat > "$MA.hs.tmp" <<'KT'
package __HS_PACKAGE__

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/*
 * ⚠️ HS-SAFE-AREA-PATCH + HS-SAF-PATCH —— 本文件由 scripts/setup-gen-android.sh 生成。
 * gen/ 是 tauri-cli 的生成物，手改会在下次 `tauri android init` 时被抹掉；要改请改脚本。
 *
 * upstream 模板只调 enableEdgeToEdge() 就完事，但 HiFiShifter 是桌面 UI 搬过来的，
 * 菜单栏/工具栏/底部状态条都贴着窗口边缘 —— 不处理 inset 就会被系统栏压住。
 * 对照数据与完整说明见 scripts/setup-gen-android.sh §7 与 docs/12。
 *
 * HS-SAF-PATCH —— SAF（文件选择）桥接需要 Activity 做两件事：
 *   · `attach(this)` 让 HifishifterFs 能 startActivityForResult；
 *   · 转发 onActivityResult 给 HifishifterFs。
 * 设计见 docs/11。
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    // 系统栏做成透明（API 35+ 本来就强制透明），图标颜色跟着窗口底色走：
    // 深色底用亮图标，浅色底用暗图标。
    val barStyle =
        if (night) SystemBarStyle.dark(Color.TRANSPARENT)
        else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
    enableEdgeToEdge(statusBarStyle = barStyle, navigationBarStyle = barStyle)

    super.onCreate(savedInstanceState)

    // SAF（文件选择）需要一个 Activity 才能 startActivityForResult（HS-SAF-PATCH）。
    HifishifterFs.attach(this)

    window.setBackgroundDrawable(ColorDrawable(ContextCompat.getColor(this, R.color.hs_chrome)))
    applySafeAreaInsets()

    // HS-RECORD-AUDIO-PATCH —— 录制需要 RECORD_AUDIO，而它是**危险权限**：
    // 光在 Manifest 里声明不够，Android 6+ 必须运行时申请，否则后端一开麦就被拒
    // （用户报「录制按钮用不了」的真因之一）。
    //
    // 为什么放在启动后 1.5s 而不是 onCreate 同步里：让首帧先画出来，权限弹窗不会
    // 盖在还在白屏的界面之上。录制是核心功能，启动时问一次是可接受的代价；
    // 用户若拒绝，系统不会再自动弹（录制失败时前端另有提示）。
    window.decorView.postDelayed({ ensureRecordAudioPermission() }, 1500)

    // HS-OPEN-WITH-PATCH —— 冷启动：从「打开方式」进来的文件先把 URI 物化并记下，
    // 前端起来后主动来取（见 HifishifterFs.acceptOpenIntent 的注释）。
    HifishifterFs.acceptOpenIntent(intent)
  }

  /**
   * HS-OPEN-WITH-PATCH —— 应用已在后台时，从「打开方式」进来的文件走这里
   * （launchMode 为 singleTask 时不会重走 onCreate）。
   * 原有两条转发保持不变，只在最后补一句。
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    pluginManager.onNewIntent(intent)
    HifishifterFs.acceptOpenIntent(intent)
  }

  /**
   * HS-RECORD-AUDIO-PATCH —— 申请录音权限（已授予则直接返回）。
   * 请求码取 9001：HifishifterFs 的保留区间与 WebView 的 ActivityResultRegistry
   * （随机码 >= 0x10000）都避开了它，不会串。
   */
  private fun ensureRecordAudioPermission() {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) return
    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 9001)
  }

  /**
   * HS-SAF-PATCH —— 把系统文件选择器的结果转给 HifishifterFs。
   *
   * 我们用 `startActivityForResult`（而不是 ActivityResultLauncher），requestCode 走
   * HifishifterFs 自己的保留区间，与 WebView 文件选择器用的
   * `ActivityResultRegistry`（随机码 >= 0x10000）不冲突。
   * 不是我们的 requestCode 时 HifishifterFs 会直接返回，不影响其它来源。
   */
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    HifishifterFs.onActivityResult(requestCode, resultCode, data)
  }

  override fun onResume() {
    super.onResume()
    // 旋转 / 分屏 / 手势导航切换 / 深浅色切换都会改变 inset，重新请求一次。
    contentView()?.let { ViewCompat.requestApplyInsets(it) }
  }

  private fun contentView(): View? = findViewById(android.R.id.content)

  private fun applySafeAreaInsets() {
    val content = contentView() ?: return
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      // systemBars + displayCutout + ime 各边取最大值：刘海区、状态栏、导航栏、
      // 软键盘一次垫完（ime 是必需的，见文件头注释）。
      val bars = insets.getInsets(
          WindowInsetsCompat.Type.systemBars()
              or WindowInsetsCompat.Type.displayCutout()
              or WindowInsetsCompat.Type.ime()
      )
      if (view.paddingLeft != bars.left || view.paddingTop != bars.top ||
          view.paddingRight != bars.right || view.paddingBottom != bars.bottom) {
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      }
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
KT
    # 占位符 → 真实包名（heredoc 带了引号，里面插不了变量）
    sed "s|__HS_PACKAGE__|$PKG_FROM_PATH|" "$MA.hs.tmp" > "$MA"
    /usr/bin/rm -f "$MA.hs.tmp"
    echo "✓ MainActivity.kt 已重写（package $PKG_FROM_PATH，含 HS-SAFE-AREA-PATCH + HS-SAF-PATCH 标记）"
  fi
fi

# ── 8. SAF 桥接：把 android/kotlin/ 的真源拷进生成物 ────────────────────────
# 为什么不能直接写在 gen/ 里：`tauri android init` 会整体重写生成物。
# 沿用与 gradlew shim、BuildTask.kt 相同的做法 —— 仓库里存真源，脚本负责重放。
# 设计见 docs/11-SAF文件访问设计.md。
echo
echo "── SAF 桥接（HifishifterFs.kt）──"

KOTLIN_SRC="$ROOT/android/kotlin"
SAF_RS="$SRC/src/platform/saf.rs"

if [ -z "$PKG_FROM_PATH" ]; then
  echo "⚠️ 拿不到包名，跳过 SAF 桥接（文件选择会一直按「用户取消」返回）" >&2
elif [ ! -f "$KOTLIN_SRC/HifishifterFs.kt" ]; then
  echo "⚠️ 找不到 $KOTLIN_SRC/HifishifterFs.kt，跳过 SAF 桥接" >&2
else
  FS_DST="$JAVA_SRC/$(printf '%s' "$PKG_FROM_PATH" | tr '.' '/')/HifishifterFs.kt"
  mkdir -p "$(dirname "$FS_DST")"
  if [ -f "$FS_DST" ] && cmp -s "$KOTLIN_SRC/HifishifterFs.kt" "$FS_DST"; then
    echo "· HifishifterFs.kt 内容一致，跳过"
  else
    cp "$KOTLIN_SRC/HifishifterFs.kt" "$FS_DST"
    echo "✓ 已拷入 HifishifterFs.kt（package $PKG_FROM_PATH）"
  fi

  # 🔴 JNI 函数名与包名**逐字符绑定**：Rust 侧写的是
  #     Java_<包名里的 . 换成 _>_HifishifterFs_nativeOnResult
  # 改了包名而没同步，症状是运行期 UnsatisfiedLinkError（编译期完全看不出来），
  # 所以在这里静态对一次账（docs/11 §6 把它列为一项风险）。
  JNI_EXPECTED="Java_$(printf '%s' "$PKG_FROM_PATH" | tr '.' '_')_HifishifterFs_nativeOnResult"
  if [ -f "$SAF_RS" ] && grep -q "$JNI_EXPECTED" "$SAF_RS"; then
    echo "· Rust JNI 符号与包名一致（$JNI_EXPECTED）"
  else
    echo "❌ Rust 侧找不到 $JNI_EXPECTED —— 包名与 platform/saf.rs 的 #[no_mangle] 函数名不一致，" >&2
    echo "   运行期会 UnsatisfiedLinkError。请同步改 $SAF_RS" >&2
  fi
fi

# ── 9. 🔴 原生库空文件修复（HS-NATIVE-LIB-FIX）─────────────────────────────
#
# 症状（2026-09-22 实测）：构建 exit 0、打印 "Finished 1 APK"，但装机启动即崩：
#   UnsatisfiedLinkError: dlopen failed: "...!/lib/x86_64/libbackend_lib.so"
#   has bad ELF magic: 504b0304        ← 504b0304 是 ZIP 头 = 空/错内容
#
# 根因：tauri-cli 打包前把 `libbackend_lib.so` / `libc++_shared.so` **symlink** 进
#   `gen/android/app/src/main/jniLibs/<abi>/`，而**本机的 symlink 静默退化成 0 字节文件**：
#   Node 侧独立复现 —— `fs.symlinkSync(src, dst)` 不抛错，但
#   `lstat(dst).isSymbolicLink() === false`（造出来的根本不是链接，tauri 以为成功了）。
#   同一条路径 `copyFileSync` 正常（76 MB）⇒ 不是权限、不是空间。
#
# 修法：在 gradle **合并 jniLibs 之前**，用 cargo target / NDK sysroot 里的真文件覆盖回去。
#   挂 `merge*JniLibFolders` 的 dependsOn（合并的输入就是 jniLibs，覆盖必须早于它）。
#   ⚠️ 只覆盖"不存在或 0 字节"的文件，绝不覆盖正常文件（避免把旧构建的 .so 写进新包）。
if ! grep -q 'HS-NATIVE-LIB-FIX' "$GRADLE"; then
  cat >> "$GRADLE" <<'KTS'

// ── HS-NATIVE-LIB-FIX ────────────────────────────────────────────────────────
// 由 scripts/setup-gen-android.sh §9 追加，勿手改（gen/ 会被 tauri android init 抹掉）。
//
// 本机 `symlink` 静默退化成 0 字节文件 ⇒ tauri 放进 jniLibs 的 native 库是空文件，
// 而 APK 照常生成、崩溃只在装机时暴露（bad ELF magic: 504b0304）。
// 这里在**合并 jniLibs 之前**把真文件补回去；只补"不存在或 0 字节"的。
val hsFixNativeLibs = tasks.register("hsFixNativeLibs") {
    doLast {
        val triples = mapOf(
            "x86_64" to "x86_64-linux-android",
            "arm64-v8a" to "aarch64-linux-android",
        )
        val tgtRoot = System.getenv("CARGO_TARGET_DIR") ?: "D:/hfshifter-target-upstream"
        val ndkDir = System.getenv("NDK_HOME") ?: android.ndkDirectory.absolutePath
        triples.forEach { (abi, triple) ->
            val dir = file("src/main/jniLibs/$abi")
            if (!dir.isDirectory) return@forEach
            val pairs = listOf(
                File("$tgtRoot/$triple/debug/libbackend_lib.so") to File(dir, "libbackend_lib.so"),
                File("$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$triple/libc++_shared.so")
                    to File(dir, "libc++_shared.so"),
            )
            pairs.forEach { (src, dst) ->
                if (src.isFile && (!dst.exists() || dst.length() == 0L)) {
                    src.copyTo(dst, overwrite = true)
                    println("[hs-fix] 补回 $abi/${dst.name}（${src.length()} bytes）")
                }
            }
        }
    }
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("JniLibFolders") }
    .configureEach { dependsOn(hsFixNativeLibs) }
// ── /HS-NATIVE-LIB-FIX ───────────────────────────────────────────────────────
KTS
  echo "✓ 原生库空文件修复已追加到 app/build.gradle.kts（HS-NATIVE-LIB-FIX）"
else
  echo "· 原生库空文件修复已存在，跳过"
fi

echo
echo "── 结果 ──"
grep -n 'minSdk\|targetSdk\|abiFilters' "$GRADLE"
# ── 10. RECORD_AUDIO 权限声明（2026-09-22）──────────────────────────────────
# 录制要用麦克风，而 tauri-cli 的模板 Manifest 只声明了 INTERNET（它不知道宿主应用
# 会不会录音）。这里补一条；运行时申请在 §7 的 HS-RECORD-AUDIO-PATCH。
#
# 为什么必须两边都做：Manifest 只是"声明"，Android 6+ 对危险权限还要**运行时授予** ——
# 只加 Manifest 的话，后端一开麦还是被拒（用户报「录制按钮用不了」的真因之一）。
echo
echo "── AndroidManifest：补 RECORD_AUDIO 与 MANAGE_EXTERNAL_STORAGE 权限 ──"
MANIFEST="$GEN_DIR/app/src/main/AndroidManifest.xml"
if [ ! -f "$MANIFEST" ]; then
  echo "⚠️ 没找到 AndroidManifest.xml，跳过（录制/全盘访问会因缺权限失败）" >&2
else
  if grep -q 'android.permission.RECORD_AUDIO' "$MANIFEST"; then
    echo "· 已有 RECORD_AUDIO，跳过"
  else
    # 锚在 `<application` 上而不是 `<uses-permission`：后者的属性列表可能跨行，
    # 而 `<application` 这个标签一定存在且不会跨行写法歧义。
    sed -i 's|\(<application\)|    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    \1|' "$MANIFEST"
    if grep -q 'android.permission.RECORD_AUDIO' "$MANIFEST"; then
      echo "✓ 已追加 RECORD_AUDIO → $(basename "$MANIFEST")"
    else
      echo "❌ 追加失败，请手工检查 $MANIFEST" >&2
    fi
  fi
  # HS-ALLFILES（2026-09-28）：**必须声明** MANAGE_EXTERNAL_STORAGE，
  # 否则系统设置里的「授予管理所有文件的权限」开关是**灰的**（Android 只对声明了该权限的
  # 应用开放这个开关），shell 侧 `appops set …` 也会被拒（真机实测：用户看到灰开关 +
  # 手动执行 appops 报 `Failed transaction`）。声明之后：设置页开关可点、appops 可用。
  if grep -q 'android.permission.MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
    echo "· 已有 MANAGE_EXTERNAL_STORAGE，跳过"
  else
    sed -i 's|\(<application\)|    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />\n    \1|' "$MANIFEST"
    if grep -q 'android.permission.MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
      echo "✓ 已追加 MANAGE_EXTERNAL_STORAGE（系统设置开关才会可点）"
    else
      echo "❌ 追加失败，请手工检查 $MANIFEST" >&2
    fi
  fi
fi

# ── 11. gradle 并发与内存（HS-WORKERS-PATCH，2026-09-22）───────────────────
# 本机 Windows 的文件锁相当激进：gradle 的 `dexBuilderUniversalDebug` 并行工作项会撞出
# `…/desugar_graph/…/graph.bin (拒绝访问)`，`compressAssets` 那边则是
# `java.nio.file.AccessDeniedException`（另一个根因，见 android-env.sh 的 TEMP 段）。
# 限制成单 worker + 关并行后稳定；代价是慢一点，但比"随机失败"划算得多。
# JVM 上限从模板的 2 GB 提到 4 GB（本机 15.7 GB），D8 处理大工程不容易 OOM。
echo
echo "── gradle.properties：并发与内存 ──"
GRADLE_PROPS="$GEN_DIR/gradle.properties"
if [ ! -f "$GRADLE_PROPS" ]; then
  echo "⚠️ 没找到 gradle.properties，跳过" >&2
elif grep -q 'HS-WORKERS-PATCH' "$GRADLE_PROPS"; then
  echo "· 已注入过，跳过"
else
  sed -i 's/-Xmx2048m/-Xmx4096m/' "$GRADLE_PROPS"
  cat >> "$GRADLE_PROPS" <<'PROPS'

# ── HS-WORKERS-PATCH（由 scripts/setup-gen-android.sh §11 注入，勿手改）──────
# 本机 Windows 文件锁激进：dexBuilder 并行工作项会撞出
# `…/desugar_graph/…/graph.bin (拒绝访问)`。单 worker + 关并行后稳定。
# 同时把 JVM 上限从模板 2 GB 提到 4 GB，D8 处理大工程不易 OOM。
org.gradle.workers.max=1
org.gradle.parallel=false
PROPS
  echo "✓ 已注入 workers.max=1 / parallel=false / -Xmx4096m"
fi


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


# ── 13. 关联文件（HS-ASSOC-FILES，2026-09-24）───────────────────────────────
# 用户口径：「在其他应用中打开本软件支持导入/打开的文件时，点以什么应用打开时
# 要能看到该软件」⇒ 就是给 MainActivity 加一组 ACTION_VIEW 的 intent-filter。
#
# 要点：
#   · `.hshp` / `.hsp` **没有注册的标准 MIME**（不像 .mp3 有 audio/mpeg），
#     文件管理器多半把它归到 `application/octet-stream` ⇒ 必须带上这个兜底，
#     否则工程文件的「打开方式」里根本不会出现本应用；
#   · 同一 `<intent-filter>` 内 **同类型属性之间是 OR、不同类型之间是 AND**，
#     所以 `content|file` × 各种 mimeType 的组合正是想要的语义。
#   · MainActivity 已是 `launchMode="singleTask"` + `exported="true"`，无需改。
echo
echo "── AndroidManifest.xml：关联文件 intent-filter ──"
MANIFEST="$GEN_DIR/app/src/main/AndroidManifest.xml"
if [ ! -f "$MANIFEST" ]; then
  echo "⚠️ 没找到 AndroidManifest.xml，跳过" >&2
elif grep -q 'HS-ASSOC-FILES' "$MANIFEST"; then
  echo "· 已注入过，跳过"
else
  python3 - "$MANIFEST" <<'PY' 2>/dev/null || echo "⚠️ 注入失败，请手工检查" >&2
import sys, pathlib
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
anchor = """                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>"""
add = anchor + """

            <!-- ── HS-ASSOC-FILES（由 scripts/setup-gen-android.sh §13 注入，勿手改）── -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/json" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="audio/midi" />
            </intent-filter>"""
if anchor not in t:
    sys.exit(1)
p.write_text(t.replace(anchor, add, 1), encoding="utf-8")
PY
  if grep -q 'HS-ASSOC-FILES' "$MANIFEST"; then
    echo "✓ 已注入关联文件 intent-filter"
  else
    echo "❌ 注入失败，请手工检查 $MANIFEST" >&2
  fi
fi

# ── 14. Shizuku（HS-SHIZUKU，2026-09-28）────────────────────────────────────
# 目的：**非 root 机**上拿到"全部文件访问"（比 SAF 更彻底：真路径直读，不需要逐目录授权、
# 也不需要读前物化）。原理是借 Shizuku 的 shell 身份执行系统自带的
#   appops set <pkg> MANAGE_EXTERNAL_STORAGE allow
# 之后 `Environment.isExternalStorageManager()` 为真 ⇒ 现有逻辑（needsAuth 判定、
# 导入路径）无需再改。用户也可改走系统设置里的「所有文件访问」页（等效，见 docs/18 §3/§6）。
#
# ⚠️ 依赖**必须写在这里**：`gen/` 会被 `tauri android init` 整棵抹掉，
#    只手改 gen 工程留不下来（本段就是给"重放"用的）。
echo
echo "── Shizuku 依赖与 provider（HS-SHIZUKU）──"
APP_GRADLE_SHZ="$GEN_DIR/app/build.gradle.kts"
if [ ! -f "$APP_GRADLE_SHZ" ]; then
  echo "⚠️ 没找到 app/build.gradle.kts，跳过 Shizuku（全盘访问会不可用）" >&2
elif grep -q 'HS-SHIZUKU' "$APP_GRADLE_SHZ"; then
  echo "· 已注入过 Shizuku 依赖，跳过"
else
  cat >> "$APP_GRADLE_SHZ" <<'GRADLE'

// ── HS-SHIZUKU（由 scripts/setup-gen-android.sh §14 注入，勿手改）───────────
// 非 root 机借 Shizuku 的 shell 身份执行
//   appops set <pkg> MANAGE_EXTERNAL_STORAGE allow
// 拿到"全部文件访问"（真路径直读，等效于系统设置里的同名开关）。
// api = 客户端接口；provider = 让 Shizuku 能找到本应用并回调权限结果。
dependencies {
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
}
GRADLE
  if grep -q 'HS-SHIZUKU' "$APP_GRADLE_SHZ"; then
    echo "✓ 已追加 Shizuku 依赖（api/provider 13.1.5）"
  else
    echo "❌ 追加失败，请手工检查 $APP_GRADLE_SHZ" >&2
  fi
fi

if [ -n "${MANIFEST:-}" ] && [ -f "$MANIFEST" ]; then
  if grep -q 'HS-SHIZUKU' "$MANIFEST"; then
    echo "· Manifest 已注入过 Shizuku provider，跳过"
  else
    # ⚠️ 锚点必须是 `<application>` **内部**的第一个子元素（这里是 `<activity`）——
    #    `<provider>` 与 `<uses-permission>` 不同，它**只能**出现在 `<application>` 里面；
    #    照抄权限那处的 `<application` 锚点会让 provider 变成 manifest 直属子元素，
    #    AAPT 直接报 `unexpected element <provider> found in <manifest>`（实测踩过）。
    #    注释用纯 ASCII：这行要经 sed 写入，中文在不同 locale 下会变乱码。
    sed -i 's|\(        <activity\)|        <!-- HS-SHIZUKU: Shizuku provider (see docs/18 section 4). NOTE: v13 REQUIRES the V3_SUPPORT meta-data; without it the client aborts natively the first time any Shizuku API is used. -->\n        <provider android:name="rikka.shizuku.ShizukuProvider" android:authorities="${applicationId}.shizuku" android:enabled="true" android:exported="true" android:multiprocess="false" android:permission="android.permission.INTERACT_ACROSS_USERS_FULL">\n            <meta-data android:name="moe.shizuku.client.V3_SUPPORT" android:value="true" />\n        </provider>\n        \1|' "$MANIFEST"
    if grep -q 'HS-SHIZUKU' "$MANIFEST"; then
      echo "✓ 已注入 ShizukuProvider → $(basename "$MANIFEST")"
    else
      echo "❌ 注入失败，请手工检查 $MANIFEST" >&2
    fi
  fi
fi

echo
echo "── 自检 ──"if [ -n "$MA" ]; then
  grep -c 'HS-SAFE-AREA-PATCH' "$MA" | sed 's/^/  MainActivity inset 补丁: /' | sed 's/1$/已应用/; s/0$/❌ 未应用/'
  grep -c 'HS-SAF-PATCH' "$MA" | sed 's/^/  MainActivity SAF 补丁: /' | sed 's/1$/已应用/; s/0$/❌ 未应用/'
  grep -c 'HS-RECORD-AUDIO-PATCH' "$MA" | sed 's/^/  MainActivity 录音权限补丁: /' | sed 's/1$/已应用/; s/0$/❌ 未应用/'
fi
if [ -n "${MANIFEST:-}" ] && [ -f "$MANIFEST" ]; then
  grep -c 'RECORD_AUDIO' "$MANIFEST" | sed 's/^/  Manifest RECORD_AUDIO: /' | sed 's/1$/已声明/; s/0$/❌ 未声明/'
fi
if [ -n "${FS_DST:-}" ]; then
  if [ -f "$FS_DST" ]; then
    echo "  HifishifterFs.kt: 已就位（$(wc -c < "$FS_DST") bytes）"
  else
    echo "  HifishifterFs.kt: ❌ 缺失"
  fi
fi
grep -c 'HS-NATIVE-LIB-FIX' "$GRADLE" | sed 's/^/  原生库空文件修复: /' | sed 's/1$/已应用/; s/0$/❌ 未应用/'
echo
echo "下一步: bash scripts/build-apk.sh $ABI"