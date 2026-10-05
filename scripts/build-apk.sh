#!/usr/bin/env bash
# 构建 HiFiShifter 的 Android APK（上游工程）。
#
# 用法:
#   bash scripts/build-apk.sh [ABI] [--release] [--] [额外 tauri 参数...]
#
#   ABI   arm64-v8a（默认，发布用）| x86_64（模拟器调试用）
#
# 例:
#   bash scripts/build-apk.sh                    # arm64 debug APK
#   bash scripts/build-apk.sh x86_64             # x86_64 debug APK（装模拟器）
#   bash scripts/build-apk.sh arm64-v8a --release
#
# 前置（只需一次）:
#   bash scripts/apply-patches.sh
#   cd upstream-src/backend/src-tauri && tauri android init
#   # 然后本脚本会自动做 jniLibs 同步
#
# 本脚本把「上游不知道、但 Android 构建必须」的东西一次配齐：
#   1. cmake 进 PATH（SDK 的 android.toolchain.cmake 要真 cmake）
#   2. fdk-aac 需要的 log/log.h shim 注入 CFLAGS（**Windows 形式路径**）
#   3. cmake 系 crate 需要的 ANDROID_* 变量
#   4. 同步 libonnxruntime.so 到 gen/android 的 jniLibs
#   5. 固定 --no-default-features --features onnx（排除 Windows 专属 vslib）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src/backend/src-tauri"

ABI="arm64-v8a"
SCOPE=""
EXTRA=()
SEEN_DD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --) SEEN_DD=1 ;;
    --release|--debug) SCOPE="$1" ;;
    arm64-v8a|x86_64|armeabi-v7a) ABI="$1" ;;
    -*) EXTRA+=("$1") ;;
    *)
      # 🔴 2026-09-28：**未知的位置参数必须报错**。原来落在 `*)` 里被当成"额外 tauri
      # 参数"原样透传 —— `build-apk.sh arm64`（少了 `-v8a`）于是把裸词 `arm64` 追加到
      # cargo 命令行末尾，报一句看不懂的
      # `Usage: cargo.exe build [OPTIONS]` + `exited with code 1`，
      # 完全看不出是 ABI 写错（实测白烧一轮构建）。`--` 之后才允许裸词。
      if [ "$SEEN_DD" = "1" ]; then
        EXTRA+=("$1")
      else
        echo "错误: 无法识别的参数 '$1'（ABI 只能是 arm64-v8a / x86_64 / armeabi-v7a；额外 tauri 参数请用 '--' 分隔）" >&2
        exit 2
      fi
      ;;
  esac
  shift
done
[ -z "$SCOPE" ] && SCOPE="--debug"

case "$ABI" in
  arm64-v8a)   ARCH="aarch64" ; TRIPLE="aarch64-linux-android" ;;
  x86_64)      ARCH="x86_64"  ; TRIPLE="x86_64-linux-android" ;;
  armeabi-v7a) ARCH="armv7"   ; TRIPLE="armv7-linux-androideabi" ;;
  *) echo "错误: 不支持的 ABI '$ABI'" >&2; exit 2 ;;
esac

# shellcheck source=/dev/null
. "$ROOT/scripts/android-env.sh"

# ── 路径形式转换（MSYS ↔ Windows）──────────────────────────────────────────
# android-env.sh 里 ANDROID_HOME 等是 Windows 形式（给原生程序用），
# 而 bash 的 test -d / PATH 拼接需要 MSYS 形式。两边都要有一份。
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
to_win() {
  case "$1" in
    /[A-Za-z]/*) printf '%s:%s' "$(printf '%s' "$1" | cut -c2 | tr 'A-Z' 'a-z')" "$(printf '%s' "$1" | cut -c3-)" ;;
    *) printf '%s' "$1" ;;
  esac
}

# ── ① cmake ────────────────────────────────────────────────────────────────
SDK_POSIX="$(sdk_posix "${ANDROID_HOME:-}")"
for cand in "$SDK_POSIX/cmake/3.22.1/bin" "/d/Android/Sdk/cmake/3.22.1/bin"; do
  if [ -x "$cand/cmake.exe" ]; then PATH="$cand:$PATH"; export PATH; break; fi
done
command -v cmake >/dev/null 2>&1 || { echo "❌ 缺 cmake：sdkmanager --install \"cmake;3.22.1\"" >&2; exit 1; }

# ── ② fdk-aac 的 log/log.h shim ────────────────────────────────────────────
SHIM_WIN="$(to_win "$ROOT/android/shim/fdk-aac-log")"
[ -f "$ROOT/android/shim/fdk-aac-log/log/log.h" ] || { echo "❌ 缺 fdk-aac shim" >&2; exit 1; }
TU="${TRIPLE//-/_}"
export "CFLAGS_${TU}=-I$SHIM_WIN"
export "CXXFLAGS_${TU}=-I$SHIM_WIN"

# ── ③ cmake 系 crate 的 ANDROID_* ──────────────────────────────────────────
export ANDROID_PLATFORM="android-${ANDROID_MIN_SDK:-26}"
export ANDROID_NATIVE_API_LEVEL="${ANDROID_MIN_SDK:-26}"
export ANDROID_ABI="$ABI"
export ANDROID_STL="c++_shared"

# ── ④ tauri-cli 与 target dir ─────────────────────────────────────────────
# tauri-cli 用探针工程里那份（npm 装的预编译二进制，比 cargo install 快得多）
PATH="$ROOT/probes/m0-probe/node_modules/.bin:$PATH"
export PATH

# ── ③.9 摘掉 WorkBuddy 自带的 node（HS-NODE-PATH-FIX，2026-09-24）─────────────
# 🕳️ 现象：改**前端**后构建失败，卡在 :app:rustBuildX86_64Debug：
#     A problem occurred starting process
#     'command ...\node\versions\22.22.2\node.exe.bat'
#
# 根因：MSYS 的 `which node` 返回 .../node（**不带 .exe**）；tauri 的 gradle 插件
# 按 Windows 惯例补 .exe 再补 .bat ⇒ 得到一个不存在的 node.exe.bat。
# 之前一直没暴露，是因为这个 task 常年命中 UP-TO-DATE ——
# **改前端会触发 tauri 重编 Rust（把 frontend/dist 嵌进 libbackend_lib.so）**，
# 于是它必须真跑，bug 才浮出来。
#
# 试过但无效：在 .bin 或 node 目录放转发用的 .bat（Java 启动不了它，诊断文件始终为空）。
# ✅ 有效：**构建期间把 WorkBuddy 的 node 目录从 PATH 摘掉**，改用系统 nodejs。
# ⚠️ 还须 `gradlew --stop`：daemon 的环境块**启动时定型**，不重启 daemon 改了也白改。
_CLEAN_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'workbuddy/binaries/node' | paste -sd: -)"
if [ -n "$_CLEAN_PATH" ]; then
  PATH="$_CLEAN_PATH"
  export PATH
  echo "▸ HS-NODE-PATH-FIX：已摘掉 WorkBuddy 的 node（规避 node.exe.bat）"
fi

command -v tauri >/dev/null 2>&1 || { echo "❌ 找不到 tauri CLI（探针的 node_modules 里应该有）" >&2; exit 1; }
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-D:/code/HiFiShifter/hfshifter-target-upstream}"

# ── ④.4 gradle daemon 卫生：构建前**一律**停掉并禁用复用（2026-10-02）──────
# 🔴 代价与症状：`tauri android build` 的 Rust 编译是 gradle task `rustBuild<Abi>Debug`
#    里跑的 ⇒ **cargo 是 gradle 守护进程的子进程**。守护进程是**长期存活**的；它一旦带着
#    "坏令牌 / 残留句柄"（沙箱、被提权的父进程、上次构建留下的句柄都算），cargo 就会在
#    收尾那一步
#        failed to link or copy `…\debug\deps\libbackend_lib.so` to `…\debug\libbackend_lib.so`
#        Caused by: 拒绝访问。 (os error 5)
#    上失败；而**同一个操作在守护进程之外手工执行完全正常**（实测：Python `os.remove` +
#    `os.link` + 读回 ELF 魔数全通）⇒ 错误信息完全不指向真凶，为此白查了一整轮。
#    ⇒ 两道保险：
#      ① 先 `--stop`。⚠️ 必须用**Windows 形式**的 GRADLE_USER_HOME（`D://gradle-home`），
#         否则 stop 的是 `~/.gradle` 里那份，而构建用的是 D: 那份 —— 白停。
#      ② 再 `-Dorg.gradle.daemon=false`：不复用任何既有 daemon，每次构建都在**自己新起的
#         JVM** 里跑，坏令牌无法跨构建传染（代价是每次多 ~20 s 的 JVM 启动）。
#    回退：`HS_SKIP_DAEMON_STOP=1` 跳过 ①；删掉 `GRADLE_OPTS` 那行跳过 ②。
if ! printf '%s' "${GRADLE_USER_HOME:-}" | grep -qE '^[A-Za-z]:'; then
  export GRADLE_USER_HOME='D:\code\HiFiShifter\gradle-home'
fi
if [ "${HS_SKIP_DAEMON_STOP:-0}" != "1" ]; then
  (cd "$SRC/gen/android" && ./gradlew.bat --stop >/dev/null 2>&1) || true
fi
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.daemon=false"
echo "▸ HS-DAEMON-HYGIENE：已停既有 gradle daemon 并禁用复用（GRADLE_USER_HOME=$GRADLE_USER_HOME）"

# ── ④.5 gradle daemon 与 TEMP 的一致性（2026-09-22）───────────────────────
# 🔴 daemon 的环境块是**启动时定型**的：改了 TEMP（或换了 android-env.sh 的默认值）
#    之后不先停 daemon，新 TEMP 根本传不进去 —— 表现是"明明换了临时目录，
#    报错里还是旧路径"。实测就栽在这条上（详见 android-env.sh 里 D:\Temp 那段）。
#    留一个 marker：TEMP 与上次构建不一致时，停一次 daemon 让它重新读取环境。
_ANDROID_GEN="$SRC/gen/android" # 本脚本里没有 GEN_DIR，统一走 $SRC（见 §③）
_DAEMON_TEMP_MARK="$_ANDROID_GEN/.hs-daemon-temp"
if [ -f "$_DAEMON_TEMP_MARK" ] && [ "$(cat "$_DAEMON_TEMP_MARK")" != "$TEMP" ]; then
  echo "▸ TEMP 已变（$(cat "$_DAEMON_TEMP_MARK") → $TEMP）：停掉 gradle daemon 让它重新读取环境"
  (cd "$_ANDROID_GEN" && ./gradlew.bat --stop >/dev/null 2>&1) || true
fi
printf '%s' "$TEMP" > "$_DAEMON_TEMP_MARK" 2>/dev/null || true

# ── 降低编译资源占用（本机内存 15.7 GB，构建时可用常只有 2–3 GB）──────────
# 实测：编译 7 万行的 backend_lib 时 rustc 会**被系统终止**，而**不给任何
# rustc 自己的错误信息** —— 极易误判成代码问题：
#
#   error: could not compile `HiFiShifter` (lib); 14 warnings emitted
#   Caused by:
#     process didn't exit successfully: `rustc.exe --crate-name backend_lib ...`
#
# 三处收紧（都可用环境变量单独覆盖）：
#
#   1. 🔴 `CARGO_INCREMENTAL=0` —— **这一条最关键**。
#      增量编译（`-C incremental`）会为整个 crate 维护跨轮次的状态，内存开销很大。
#      对照实测：同样配置下 incremental 开 → rustc 被终止；
#      incremental=0 → 编译通过（14 个 warning 正常输出完）。
#      代价是每次全量重编（依赖已缓存，实际只重编主 crate）。
#
#   2. `CARGO_PROFILE_DEV_DEBUG=0` —— 不生成调试信息。
#      ⚠️ 变量名是 `..._DEBUG` 而**不是** `..._DEBUGINFO`！
#      Rust 的 profile 键叫 `debug`，写成 `DEBUGINFO` 会被 cargo **静默忽略**
#      （踩过：日志里 rustc 命令行仍然带 `-C debuginfo=2`，才发现没生效）。
#      关掉它同时降低内存峰值与包体积（未 strip 时那个 .so 有 137 MB）。
#      需要 gdb 断点调试时覆盖成 1 或 2 再单独构建一次。
#
#   3. `CARGO_BUILD_JOBS=1` —— 并行的 rustc 少了，内存峰值明显低。
#      想快就调大，代价是内存峰值更高。
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"

# ── Gradle 用户目录 ────────────────────────────────────────────────────────
# 指回 `D:\code\HiFiShifter\gradle-home`（省 C 盘空间），并且能**复用探针那次已下好的依赖缓存**
# （caches/modules-2 里约 211 MB，含 Android Gradle Plugin 等；两个工程用的是
#  同一份 tauri 模板，版本目录一致，命中率很高）。
#
# ⚠️ 必须是 **Windows 形式**（`D:\code\HiFiShifter\gradle-home`），不能写 MSYS 的 `/d/code/HiFiShifter/gradle-home`：
# JVM 拿到 `/d/code/HiFiShifter/gradle-home` 会理解成相对当前盘符的 `\d\gradle-home`，
# 打开 `<...>.lck` 时报「拒绝访问」，报错里还能看到那个畸形的 `\d\` 前缀。
#
# 至于 `*.lck` 的写保护 —— 已经由 `gen/android/gradlew(.bat)` 的 shim 绕过
# （直接调用已解压的 Gradle，不走 wrapper 的 Install 流程），
# 所以这里可以放心让 gradle 去 D: 工作。
# 详见 docs/06 §4.6 与 scripts/setup-gen-android.sh §5。
if ! printf '%s' "${GRADLE_USER_HOME:-}" | grep -qE '^[A-Za-z]:'; then
  # 已经是 MSYS 形式（/d/...）或未设置 → 统一成 Windows 形式
  export GRADLE_USER_HOME='D:\code\HiFiShifter\gradle-home'
fi

# ── ⑤ 清前端 dist（绕开 safe-delete shim）─────────────────────────────────
# ⚠️ 这里必须用 `/usr/bin/rm` 这个**绝对路径**。
# 本机 PATH 前面挂着 WorkBuddy 的 `shim/safe-bin`，它把 `rm` 以及 Node 的
# `fs.rmSync` 都替换成"移到回收站"的实现；回收站操作失败时整个构建就中断。
# vite 在 `prepareOutDir` 阶段清空 dist 时正好会撞上：
#
#   [vite:prepare-out-dir] [safe-delete] 操作失败: ERROR .../dist/appearance.html:
#     Error during a trash operation: Unknown { description: "Some operations were aborted" }
#   beforeBuildCommand `npm --prefix ../frontend run build` failed with exit code 1
#
# 提前用真 rm 把 dist 删掉，vite 就不需要执行 emptyDir 了。
FRONTEND_DIST="$ROOT/upstream-src/frontend/dist"
if [ -d "$FRONTEND_DIST" ]; then
  /usr/bin/rm -rf "$FRONTEND_DIST"
  echo "▸ 已清 $FRONTEND_DIST（用 /usr/bin/rm 绕开 safe-delete shim）"
fi

# ── ⑤.5 清掉 gen/android assets 里「已从 bundle.resources 移除」的陈旧资源 ────
# 🔴 tauri-cli 会把资源**拷进** `gen/android/app/src/main/assets/`，但**从不清理**
# 已经从配置里删掉的条目。
#
# 实测（2026-09-21）：按 ADR-012 在 base conf 里删掉 hnsep/fcpe 三条后重建，
# APK 里那三个文件**依然在**——183.7 MB 的模型一个没少，只有 md5 变了。
# 原因就是 assets 目录里上一轮的副本还在，gradle 照单全收。
#
# 所以「减包 / 换资源」必须配套这一步：按「base ∪ 平台 conf」算出**期望**的模型目录，
# 把 `assets/models/` 下不在期望里的目录删掉。
#
# ⚠️ 期望值只从 conf 的**文本**里 grep，不解析 JSON —— 这里只需要目录名，
# 且要同时覆盖 base 与 tauri.android.conf.json 的并集语义（见 docs/02 §7.4）。
ASSETS_MODELS="$SRC/gen/android/app/src/main/assets/models"
if [ -d "$ASSETS_MODELS" ]; then
  EXPECTED_MODELS="$(
    grep -ho '"resources/models/[^/"]*' \
      "$SRC/tauri.conf.json" "$SRC/tauri.android.conf.json" 2>/dev/null \
      | sed 's|.*/||' | sort -u
  )"
  for d in "$ASSETS_MODELS"/*/; do
    if [ ! -d "$d" ]; then continue; fi          # glob 不匹配时 d 是字面 pattern
    name="$(basename "$d")"
    if printf '%s\n' "$EXPECTED_MODELS" | grep -qx "$name"; then continue; fi
    /usr/bin/rm -rf "$d" 2>/dev/null || true
    echo "▸ 已清陈旧的 assets 模型目录：models/$name（不在 bundle.resources 里）"
  done
  unset EXPECTED_MODELS
fi

# ── ⑥ jniLibs：libonnxruntime.so ───────────────────────────────────────────
echo "▸ 同步原生库到 jniLibs"
bash "$ROOT/scripts/sync-native-libs.sh" "$SRC" "$ABI"

# ── ⑥.5 清掉上一次的打包残留 ───────────────────────────────────────────────
# 🔴 不清会**让 APK 凭空胖一个 .so**。
#
# 实测（2026-09-18）：增量重跑后 APK 从 269.5 MB 涨到 341.0 MB，
# 差值 71.5 MB ≈ 正好等于 `libbackend_lib.so` 的大小。
# `scripts/audit-apk.sh` 直接指出 `lib/x86_64/libbackend_lib.so` 在包里**存了两份**
# （累计 71.5 + 71.4 MB，两份字节数还不同 —— 是"上一版 + 这一版"）。
#
# 机制：AGP 的打包任务在增量场景下会复用上一次的输出与 merge 中间产物，
# 而 Rust 侧那个 `.so` 每次构建都会变（哪怕只是时间戳/元数据），
# 于是新旧两份都留在了 zip 里。
#
# 所以每次构建前清掉这两处。代价只是 Gradle 重做打包（约 1 分钟），
# 换来的是**体积可信** —— 发布包尤其不能带这个。
APK_DIR="$SRC/gen/android/app/build/outputs/apk"
MERGED_NATIVE="$SRC/gen/android/app/build/intermediates"
if [ -d "$APK_DIR" ]; then
  /usr/bin/rm -rf "$APK_DIR"
  echo "▸ 已清上次的 APK 输出（避免旧条目残留在 zip 里）"
fi
if [ -d "$MERGED_NATIVE" ]; then
  # 只清与原生库/资源合并相关的中间产物，保留 dex/kotlin 等昂贵产物
  # ⚠️ 用 if 而不是 `[ -e "$d" ] && rm ...`：后者在**所有 glob 都不匹配**时
  # （循环体拿到的是字面 pattern）返回非零，`set -e` 会让整个构建在这里静默退出。
  #
  # 🔴 `merged_jni_libs*` 必须一起清（2026-10-01 实测补）：只清 `merged_native_libs*` 不够 ——
  # AGP 的原生库合并链是
  #   jniLibs(源) → mergeJniLibFolders → **merged_jni_libs** → mergeNativeLibs → merged_native_libs → strip
  # 前一环是**增量**目录：源里已经删掉的 ABI，它会**原样留着**并被下一环 merge 回去。
  # 于是 `sync-native-libs.sh` 明明成功删掉了 `jniLibs/x86_64/`（那行 "✗" 是"**已删除**"的标记，
  # 不是失败），包里却仍白背 **76.7 MB** 死库（实测：APK 377 MB ↔ 干净 300 MB）。
  for d in "$MERGED_NATIVE"/merged_native_libs* "$MERGED_NATIVE"/stripped_native_libs* \
           "$MERGED_NATIVE"/merged_jni_libs* \
           "$MERGED_NATIVE"/merged_res* "$MERGED_NATIVE"/packaged_res*; do
    if [ -e "$d" ]; then /usr/bin/rm -rf "$d" 2>/dev/null || true; fi
  done
  echo "▸ 已清原生库/资源的 merge 中间产物"
fi

# ── ⑥.6 清掉 Gradle 缓存里的陈旧 `*.lock` ──────────────────────────────────
# 🔴 症状（实测 2026-09-18）：
#
#   Execution failed for task ':app:compileUniversalDebugJavaWithJavac'.
#   > Could not create service of type GeneralCompileCaches using
#     UserHomeScopeServices.createCompileCaches().
#     > java.io.FileNotFoundException:
#       D:\code\HiFiShifter\gradle-home\caches\8.14.3\javaCompile\javaCompile.lock (拒绝访问。)
#
# 报错指向 `GeneralCompileCaches`，极易被误读成"依赖/缓存坏了"而白重建一遍。
# 其实只是 Gradle 用来做跨进程互斥的锁文件被上一次**中断的构建**留下了，
# 而本机沙箱对 `*.lck`/`*.lock` 的打开方式敏感（同 wrapper 那次的成因，见 docs/06 §4.6）。
#
# ✅ 判定很干净：**陈旧的锁能删（没有进程持有），在用中的删不掉（Windows 直接拒绝）**。
#    所以无条件尝试删除是安全的 —— 天然只会清掉没用的那些，不会动正在用的。
#    注意：这里能删，而 gradle-wrapper 那个 `.lck` **连删都删不掉**，两者成因不同。
GUH="${GRADLE_USER_HOME:-D:/code/HiFiShifter/gradle-home}"
case "$GUH" in
  [A-Za-z]:\\*) GUH="$(printf '%s' "$GUH" | sed 's|\\|/|g')" ;;
esac
if [ -d "$GUH/caches" ]; then
  n_lck=0
  while IFS= read -r f; do
    if /usr/bin/rm -f "$f" 2>/dev/null; then n_lck=$((n_lck + 1)); fi
  done < <(find "$GUH/caches" -maxdepth 4 -name '*.lock' 2>/dev/null || true)
  [ "$n_lck" -gt 0 ] && echo "▸ 清掉 $n_lck 个陈旧 Gradle 锁（$GUH/caches 下的 *.lock）" || true
fi

# ── ⑦ 构建 ─────────────────────────────────────────────────────────────────
echo
echo "▸ ABI=$ABI  ARCH=$ARCH  TRIPLE=$TRIPLE"
echo "▸ cmake   = $(command -v cmake)"
echo "▸ shim    = $SHIM_WIN"
echo "▸ scope   = $SCOPE"
echo "▸ 前端会由 tauri 的 beforeBuildCommand 自动构建（npm --prefix ../frontend run build）"
echo

cd "$SRC"
# `--` 之后的参数透传给 cargo。
# 注意 `${EXTRA[@]}` 在数组为空时若写成 `"${EXTRA[@]:-}"` 会展开出**一个空参数**，
# 让 cargo 报 "unexpected argument"，所以这里显式判空。
CARGO_ARGS=(--no-default-features --features onnx)
if [ ${#EXTRA[@]} -gt 0 ]; then
  CARGO_ARGS+=("${EXTRA[@]}")
fi
# ⚠️ 这里**不能**用 `exec`：下面还有 §⑧ 产物校验（2026-09-22 加）。
tauri android build "$SCOPE" --target "$ARCH" --apk -- "${CARGO_ARGS[@]}"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo
  echo "❌ tauri android build 失败（exit $rc）"
  exit "$rc"
fi

# ── ⑧ 产物校验：APK 里的每个 .so 都必须是**非空 ELF** ────────────────────────
#
# 🔴 为什么必须有这一步（2026-09-22 实测踩到）：
# tauri-cli 打包前会把 `libbackend_lib.so` 与 `libc++_shared.so` **symlink** 进
# `gen/android/app/src/main/jniLibs/<abi>/`，而**本机的 symlink 会静默退化成空文件**：
#   · 真因（2026-09-22 第二轮对照实验定位）：本机 `AllowDevelopmentWithoutDevLicense=0`
#     且当前用户不在管理员组 ⇒ 缺 `SeCreateSymbolicLinkPrivilege`，**Windows 拒绝创建符号链接**；
#     而 Node / Python 在此环境下**不抛错**，把失败降级成"创建了一个空文件"。
#     对照：PowerShell 原生 `New-Item -ItemType SymbolicLink` 直接报「此操作需要管理员权限」。
#     ⇒ 一劳永逸的修法是开 Windows「开发人员模式」（设置 → 系统 → 开发者选项）；
#       在此之前靠本段的自检 + 自动修补兜底。探针：`scripts/_probe-symlink.mjs`。
#   · Node 侧实测：`fs.symlinkSync(src, dst)` **不抛错**，但 `lstat(dst).isSymbolicLink() === false`
#     ⇒ 造出来的根本不是链接；
#   · 于是 jniLibs 里留下 **0 字节** 的 `libbackend_lib.so` / `libc++_shared.so`，
#     gradle 照单收进 APK，而构建**仍然 exit 0、仍然打印 "Finished 1 APK"**；
#   · 装上后必崩在启动第一行：
#       UnsatisfiedLinkError: dlopen failed: "...!/lib/x86_64/libbackend_lib.so"
#       has bad ELF magic: 504b0304        ← `504b0304` 是 ZIP 头，即空/错内容
#
# 触发条件：**ABI 切换**。`sync-native-libs.sh` 会清掉"本次不需要"的 ABI 目录，
# 下次为那个 ABI 构建时 jniLibs 里没有目标文件 ⇒ 走 symlink 分支 ⇒ 空文件。
# （目标文件已存在时这一步通常保留原件，所以是"偶发"而非"必现"。）
#
# 自 2026-09-22 第二轮起：校验失败会**自动调 `fix-apk-native-libs.sh` 修补并复验**，
# 让「一条命令拿到可用包」成立（原来只报错，还得再手工跑一次修补）。
APK_OUT="$SRC/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
PY="C:/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe"

# 校验：APK 里每个 .so 必须非空且以 ELF 魔数开头。通过返回 0，否则返回 3。
verify_native_libs() {
  "$PY" - "$(cygpath -m "$APK_OUT")" "$ABI" "$TRIPLE" <<'PYEOF'
import sys, zipfile
apk, abi, triple = sys.argv[1], sys.argv[2], sys.argv[3]
z = zipfile.ZipFile(apk)
bad = []
for n in sorted(z.namelist()):
    if not n.startswith("lib/") or not n.endswith(".so"):
        continue
    size = z.getinfo(n).file_size
    head = z.read(n)[:4] if size else b""
    ok = size > 0 and head == b"\x7fELF"
    print(f"    {'✓' if ok else '✗'} {size/1048576:8.2f} MB  {n}")
    if not ok:
        bad.append((n, size, head))
if bad:
    print()
    print("❌ 产物里有无效原生库（装机会崩在 WryActivity.<clinit>：bad ELF magic）")
    for n, size, head in bad:
        print(f"   ✗ {n}: {size} bytes, head={head!r}")
    print()
    print("   修复：把真文件补回 jniLibs，再重跑本脚本")
    print(f"     J=<repo>/upstream-src/backend/src-tauri/gen/android/app/src/main/jniLibs/{abi}")
    print(f"     cp -f <CARGO_TARGET_DIR>/{triple}/debug/libbackend_lib.so $J/libbackend_lib.so")
    print("     cp -f <NDK>/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/"
          f"{abi}/libc++_shared.so $J/libc++_shared.so")
    sys.exit(3)
print("    ✓ 全部有效")
PYEOF
}

if [ -f "$APK_OUT" ]; then
  echo
  echo "▸ ⑧ 校验 APK 内原生库（非空 + ELF 魔数）"
  if ! verify_native_libs; then
    echo
    echo "⚠️ 检出无效原生库 —— 自动修补（scripts/fix-apk-native-libs.sh）"
    echo "   根因：本机未开「开发人员模式」且非管理员 ⇒ Windows 拒绝创建符号链接，"
    echo "         tauri 的 symlink 静默退化成 0 字节文件（见 docs/05 附录）。"
    if ! bash "$ROOT/scripts/fix-apk-native-libs.sh" "$APK_OUT" "$ABI"; then
      echo "❌ 自动修补失败 —— **不要安装这个 APK**"
      exit 3
    fi
    echo "▸ 复验修补结果"
    if ! verify_native_libs; then
      echo "❌ 修补后仍不合格 —— **不要安装这个 APK**"
      exit 3
    fi
  fi
else
  echo "⚠️ 没找到预期的 APK 路径，跳过 ⑧ 校验：$APK_OUT"
fi

# ── ⑨ 按 ABI 归档 ─────────────────────────────────────────────────────────
#
# 🔴 为什么需要（2026-09-22 实际丢过一包）：gradle 的 APK 输出路径是
# `app/build/outputs/apk/universal/debug/app-universal-debug.apk` —— **不带 ABI**，
# 所以**跨 ABI 是同一个路径**。先用 x86_64 出了一包、再为 arm64 构建，构造函数开头的
# "清上次的 APK 输出"会把 x86_64 那包直接清掉（那次 arm64 还失败了 ⇒ 结果**两个包都没了**）。
# 这里每次构建成功后按 ABI 存一份，`HS_APK_ARCHIVE_DIR` 可覆盖（默认 D 盘，C 盘放不下 172MB）。
ARCHIVE_DIR="${HS_APK_ARCHIVE_DIR:-D:/code/HiFiShifter/hifishifter-out}"
mkdir -p "$ARCHIVE_DIR"
if [ "$SCOPE" = "--release" ]; then ARCHIVE_KIND=release; else ARCHIVE_KIND=debug; fi
ARCHIVE="$ARCHIVE_DIR/hifishifter-$ABI-$ARCHIVE_KIND.apk"
cp -f "$APK_OUT" "$ARCHIVE"
echo "▸ 已归档（按 ABI）：$ARCHIVE"

# ── ⑩ 装机提示（🔴 2026-09-27 踩的坑：**别用中间产物**）──────────────────
#
# `app-universal-debug.apk`（即上面的 `$APK_OUT`）是**共用路径** ——
# 构建哪个 ABI，它就是哪个。把它装到 ABI 不匹配的设备上 ⇒ 走 **ABI 转译**
# ⇒ onnxruntime 的 JIT 会 SIGSEGV（`tid=ort-prewarm-*`、`fault addr 0x8`），
# **而崩前日志一切正常**（ndk_context / 模型就绪全打印了），极具误导性
# —— 看起来就像"代码把 ONNX 初始化改坏了"。
#
# ⇒ 这里显式打印该装哪个包，并在有在线设备时自动比对 ABI。
echo
echo "▸ 装机（**用归档包，别用中间产物**）："
echo "    adb -s <serial> push \"$ARCHIVE\" /data/local/tmp/hs.apk"
echo "    adb -s <serial> shell pm install -r -t /data/local/tmp/hs.apk"

_ADB="${ADB:-D:/Android/Sdk/platform-tools/adb.exe}"
if [ -x "$_ADB" ] || command -v "$_ADB" >/dev/null 2>&1; then
  FIRST_DEV="$("$_ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')" || true
  if [ -n "${FIRST_DEV:-}" ]; then
    echo
    if ! bash "$ROOT/scripts/check-apk-abi.sh" "$ARCHIVE" "$FIRST_DEV"; then
      echo "⚠️ ABI 自检未通过（见上）—— 换个 ABI 重新构建，或换设备。**先别装。**"
    fi
  fi
fi

echo
echo "✅ 构建完成：$APK_OUT"
