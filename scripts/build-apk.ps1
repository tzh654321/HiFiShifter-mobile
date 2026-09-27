# ══════════════════════════════════════════════════════════════════════════════
# build-apk.ps1 —— `scripts/build-apk.sh` 的 PowerShell 等价入口
#
# 为什么要有这一份：本机（DSH 环境）**没有 bash / git**（PATH 与常见安装位置都查过），
# 而 build-apk.sh 是 Git Bash 脚本。构建链路本身与 shell 无关，只是环境变量 + 清理 +
# 调 tauri-cli，所以这里逐条复刻，行为与 .sh 保持一致；改动请**两边一起改**。
#
# 用法：
#   pwsh -File scripts/build-apk.ps1                 # arm64-v8a debug（默认）
#   pwsh -File scripts/build-apk.ps1 x86_64          # 模拟器用
#   pwsh -File scripts/build-apk.ps1 arm64-v8a -Release
#
# 与原脚本一致的关键点（都是踩过的坑，别删）：
#   · JDK 必须 17（JDK 21 会让 build-tools 的 R8/D8 抛 NPE）
#   · GRADLE_USER_HOME 必须是 **Windows 形式**（JVM 不认 MSYS 的 /d/...）
#   · TEMP/TMP 显式指到 D:（C: 常年只剩几百 MB，构建会写满）
#   · CARGO_INCREMENTAL=0 / CARGO_PROFILE_DEV_DEBUG=0 / CARGO_BUILD_JOBS=1（防 rustc 被 OOM 杀）
#   · 构建前清：前端 dist、assets 里已从 conf 移除的模型、上次的 APK 输出、merge 中间产物、
#     陈旧 gradle *.lock、jniLibs 里不属于本次 ABI 的目录
# ══════════════════════════════════════════════════════════════════════════════
[CmdletBinding()]
param(
    [ValidateSet('arm64-v8a', 'x86_64', 'armeabi-v7a')]
    [string]$Abi = 'arm64-v8a',
    [switch]$Release
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$Src = Join-Path $Root 'upstream-src/backend/src-tauri'

switch ($Abi) {
    'arm64-v8a' { $Arch = 'aarch64'; $Triple = 'aarch64-linux-android' }
    'x86_64' { $Arch = 'x86_64'; $Triple = 'x86_64-linux-android' }
    'armeabi-v7a' { $Arch = 'armv7'; $Triple = 'armv7-linux-androideabi' }
}

if (-not (Test-Path $Src)) { throw "找不到 $Src" }

# ── ① 环境变量（对应 android-env.sh + build-apk.sh）──────────────────────────
$JdkHome = 'D:\Download\zulu17.64.17-ca-jdk17.0.18-win_x64'
$AndroidHome = 'D:\Android\Sdk'
$NdkHome = "$AndroidHome\ndk\27.2.12479018"
$CmakeBin = "$AndroidHome\cmake\3.22.1\bin"

# JDK 必须 17：先按 major 版本校验，不合格直接报错（悄悄用 21 会以 R8/D8 NPE 的形式炸）
$javaExe = Join-Path $JdkHome 'bin/java.exe'
if (-not (Test-Path $javaExe)) { throw "缺 JDK 17：$JdkHome" }
$jver = (& $javaExe -version 2>&1 | Select-Object -First 1)
if ($jver -notmatch '"17\.') { throw "JAVA_HOME 不是 JDK 17（会触发 R8/D8 的 NPE）：$jver" }

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:NDK_HOME = $NdkHome
$env:ANDROID_NDK_HOME = $NdkHome
$env:RUSTUP_TOOLCHAIN = if ($env:RUSTUP_TOOLCHAIN) { $env:RUSTUP_TOOLCHAIN } else { 'stable' }

# PATH：cmake（android.toolchain.cmake 要真 cmake）/ JDK17 / platform-tools / build-tools /
#       cargo / node。node 是给 tauri-cli 与前端构建用的。
$env:PATH = @(
    $CmakeBin
    "$JdkHome\bin"
    "$AndroidHome\platform-tools"
    "$AndroidHome\build-tools\35.0.0"
    'C:\Users\tzh\.cargo\bin'
    'C:\Program Files\nodejs'
    $env:PATH
) -join ';'

# ── ② cmake 与 shim 自检 ─────────────────────────────────────────────────────
if (-not (Test-Path "$CmakeBin/cmake.exe")) { throw "缺 cmake：$CmakeBin（sdkmanager --install `"cmake;3.22.1`"）" }
$ShimWin = Join-Path $Root 'android/shim/fdk-aac-log'
if (-not (Test-Path "$ShimWin/log/log.h")) { throw "缺 fdk-aac shim：$ShimWin/log/log.h" }

# fdk-aac 的 log/log.h shim：只对**当前 triple** 生效（变量名里带 triple，连字符换下划线）
$tu = $Triple -replace '-', '_'
Set-Item -Path "env:CFLAGS_$tu" -Value "-I$ShimWin"
Set-Item -Path "env:CXXFLAGS_$tu" -Value "-I$ShimWin"

# cmake 系 crate 需要的 ANDROID_*
$env:ANDROID_PLATFORM = 'android-26'
$env:ANDROID_NATIVE_API_LEVEL = '26'
$env:ANDROID_ABI = $Abi
$env:ANDROID_STL = 'c++_shared'

# ── ③ 降低编译资源占用（本机 15.7 GB 内存，构建时可用常只有 2–3 GB）──────────
# CARGO_INCREMENTAL=0 是关键：开增量时 rustc 会被系统终止且**不给任何 rustc 错误**。
$env:CARGO_TARGET_DIR = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'D:/hfshifter-target-upstream' }
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_BUILD_JOBS = '1'

# ── ④ Gradle 用户目录（Windows 形式！）+ 临时目录 ────────────────────────────
$env:GRADLE_USER_HOME = 'D:\gradle-home'
$env:TEMP = 'D:\Temp'
$env:TMP = 'D:\Temp'
if (-not (Test-Path 'D:\Temp')) { New-Item -ItemType Directory -Path 'D:\Temp' -Force | Out-Null }

# ── ⑤ 规避失效的本地代理（127.0.0.1:7892 实测已挂；直连反而通）────────────────
$env:NO_PROXY = '*'
$env:no_proxy = '*'
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:http_proxy = ''
$env:https_proxy = ''

# ── ⑥ 清前端 dist ────────────────────────────────────────────────────────────
# vite 在 prepareOutDir 阶段清 dist；先删掉就不必走那一步（本环境无 safe-delete shim，
# 但保留这一步能让构建结果与 .sh 路径完全一致）。
$FeDist = Join-Path $Root 'upstream-src/frontend/dist'
if (Test-Path $FeDist) {
    Remove-Item $FeDist -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '▸ 已清前端 dist'
}

# ── ⑦ 清掉 assets 里「已从 bundle.resources 移除」的陈旧模型 ─────────────────
# tauri-cli 会把资源**拷进** assets 但从不清理已删条目 ⇒ 减包会失效（实测 270→165 MB 靠这一步）
$AssetsModels = Join-Path $Src 'gen/android/app/src/main/assets/models'
if (Test-Path $AssetsModels) {
    $confText = ''
    foreach ($f in @('tauri.conf.json', 'tauri.android.conf.json')) {
        $p = Join-Path $Src $f
        if (Test-Path $p) { $confText += (Get-Content $p -Raw -Encoding UTF8) }
    }
    $expected = [regex]::Matches($confText, '"resources/models/([^/"]+)') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    foreach ($d in Get-ChildItem $AssetsModels -Directory) {
        if ($expected -contains $d.Name) { continue }
        Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "▸ 已清陈旧的 assets 模型目录：models/$($d.Name)（不在 bundle.resources 里）"
    }
}

# ── ⑧ jniLibs 同步（sync-native-libs.sh 的等价实现）──────────────────────────
$Jni = Join-Path $Src 'gen/android/app/src/main/jniLibs'
if (-not (Test-Path (Join-Path $Src 'gen/android'))) { throw "缺 gen/android —— 先跑 npx tauri android init" }

$Onnx = Join-Path $Root "third_party/onnxruntime/$Abi/libonnxruntime.so"
if (-not (Test-Path $Onnx)) { throw "缺 $Onnx" }
$jniAbi = Join-Path $Jni $Abi
New-Item -ItemType Directory -Path $jniAbi -Force | Out-Null
Copy-Item $Onnx (Join-Path $jniAbi 'libonnxruntime.so') -Force
Write-Host "  ✓ $Abi/libonnxruntime.so  $([math]::Round((Get-Item $Onnx).Length/1MB,1)) MB"

# SoundTouch 由 build.rs 编译到 cargo target；tauri-cli **不会**自动带它，
# 缺了会在 WryActivity.<clinit> 报 UnsatisfiedLinkError（libSoundTouchDLL.so not found）
$tgtPosix = $env:CARGO_TARGET_DIR -replace '\\', '/'
foreach ($prof in @('debug', 'release')) {
    $st = Join-Path "$tgtPosix/$Triple/$prof" 'libSoundTouchDLL.so'
    if (Test-Path $st) {
        Copy-Item $st (Join-Path $jniAbi 'libSoundTouchDLL.so') -Force
        Write-Host "  ✓ $Abi/libSoundTouchDLL.so（兜底同步）"
        break
    }
}

# 清掉「这次没被请求」的整个 ABI 目录：否则 universal APK 会把别的 ABI 也打进去（体积翻倍）
foreach ($d in (Get-ChildItem $Jni -Directory -ErrorAction SilentlyContinue)) {
    if ($d.Name -eq $Abi) { continue }
    Remove-Item $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  ✗ 清除陈旧 ABI 目录 $($d.Name)/（本次不需要）"
}

# ── ⑨ 清上次的打包残留（否则新 .so 会与旧的一份同时进 zip）──────────────────
$ApkDir = Join-Path $Src 'gen/android/app/build/outputs/apk'
if (Test-Path $ApkDir) {
    Remove-Item $ApkDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '▸ 已清上次的 APK 输出'
}
$Interm = Join-Path $Src 'gen/android/app/build/intermediates'
if (Test-Path $Interm) {
    foreach ($pat in @('merged_native_libs*', 'stripped_native_libs*', 'merged_res*', 'packaged_res*')) {
        Get-ChildItem $Interm -Filter $pat -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }
    Write-Host '▸ 已清原生库/资源的 merge 中间产物'
}

# ── ⑩ 清陈旧 Gradle 锁（在用中的删不掉，Windows 会拒绝 ⇒ 无条件尝试是安全的）──
$guh = $env:GRADLE_USER_HOME
$nLck = 0
if (Test-Path "$guh/caches") {
    Get-ChildItem "$guh/caches" -Filter '*.lock' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        ForEach-Object { if (Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue) { $script:nLck++ } }
    if ($nLck -gt 0) { Write-Host "▸ 清掉 $nLck 个陈旧 Gradle 锁" }
}

# ── ⑪ 构建 ───────────────────────────────────────────────────────────────────
$TauriJs = Join-Path $Root 'probes/m0-probe/node_modules/@tauri-apps/cli/tauri.js'
if (-not (Test-Path $TauriJs)) { throw "找不到 tauri CLI：$TauriJs（cd probes/m0-probe && npm install）" }
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

$scope = if ($Release) { '--release' } else { '--debug' }
Write-Host ''
Write-Host "▸ ABI=$Abi  ARCH=$Arch  TRIPLE=$Triple  $scope"
Write-Host "▸ cmake   = $CmakeBin\cmake.exe"
Write-Host "▸ shim    = $ShimWin"
Write-Host '▸ 前端由 tauri 的 beforeBuildCommand 自动构建（npm --prefix ../frontend run build）'
Write-Host ''

Push-Location $Src
try {
    & $node $TauriJs android build $scope --target $Arch --apk -- --no-default-features --features onnx
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) { throw "tauri android build 失败（exit=$code）" }

$apk = Get-ChildItem $ApkDir -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ''
if ($apk) {
    Write-Host "✅ APK: $($apk.FullName)"
    Write-Host "   大小 $([math]::Round($apk.Length/1MB,1)) MB   时间 $($apk.LastWriteTime)"
} else {
    Write-Host '⚠️ 构建结束但没在 outputs/apk 下找到 APK'
}
