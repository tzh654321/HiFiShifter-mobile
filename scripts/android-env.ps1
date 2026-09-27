# HiFiShifter 安卓移植 · 环境变量（PowerShell 用）
#
#   . .\scripts\android-env.ps1
#
# 路径均来自本机已实测可用的配置，说明见 scripts/android-env.sh 的注释。

$env:JAVA_HOME          = "D:\Download\_tools\jdk-17"
$env:ANDROID_HOME       = "D:\Android\Sdk"
$env:ANDROID_SDK_ROOT   = "D:\Android\Sdk"
$env:NDK_HOME           = "D:\Android\Sdk\ndk\27.2.12479018"
$env:ANDROID_NDK_HOME   = "D:\Android\Sdk\ndk\27.2.12479018"

# Gradle 缓存放 D:（C: 只剩 33 GB，D: 有 61 GB）
$env:GRADLE_USER_HOME   = "D:\gradle-home"

$env:PATH = @(
    "$env:USERPROFILE\.cargo\bin",
    "D:\Download\_tools\jdk-17\bin",
    "D:\Android\Sdk\platform-tools",
    "D:\Android\Sdk\build-tools\35.0.0",
    $env:PATH
) -join ";"

# 屏蔽失效的本地代理（127.0.0.1:7892 实测已挂）。
# 代理客户端恢复后把这几行去掉即可。
$env:NO_PROXY   = "*"
$env:no_proxy   = "*"
Remove-Item Env:HTTP_PROXY  -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:http_proxy  -ErrorAction SilentlyContinue
Remove-Item Env:https_proxy -ErrorAction SilentlyContinue

# Rust 分发镜像：直连 static.rust-lang.org 实测只有 7.7 KB/s，
# 清华 TUNA 实测 4.29 MB/s。crates.io 镜像在项目根的 .cargo/config.toml 里。
$env:RUSTUP_DIST_SERVER  = "https://mirrors.tuna.tsinghua.edu.cn/rustup"
$env:RUSTUP_UPDATE_ROOT  = "https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup"

Write-Host "-- HiFiShifter Android 环境 --" -ForegroundColor Cyan

function Test-Tool($name, $path) {
    if (Test-Path $path) { Write-Host "  OK   $name" }
    else { Write-Host "  MISS $name  -> $path" -ForegroundColor Yellow }
}

Test-Tool "JDK 17"          "D:\Download\_tools\jdk-17\bin\java.exe"
Test-Tool "SDK platform 35" "D:\Android\Sdk\platforms\android-35"
Test-Tool "build-tools 35"  "D:\Android\Sdk\build-tools\35.0.0"
Test-Tool "NDK 27.2"        "D:\Android\Sdk\ndk\27.2.12479018"
Test-Tool "adb"             "D:\Android\Sdk\platform-tools\adb.exe"

if (Get-Command rustc -ErrorAction SilentlyContinue) {
    Write-Host "  OK   rustc $((rustc --version))"
} else {
    Write-Host "  MISS rustc（装完 Rust 后重开终端）" -ForegroundColor Yellow
}

Write-Host "-----------------------------" -ForegroundColor Cyan
