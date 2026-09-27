# 创建 HiFiShifter 测试用 AVD
#
#   . .\scripts\android-env.ps1
#   .\scripts\make-avd.ps1                  # 建 x86_64 AVD（推荐，见下方说明）
#   .\scripts\make-avd.ps1 -Abi arm64-v8a   # 会失败，保留仅为记录原因
#   .\scripts\make-avd.ps1 -List
#
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ 关键事实（2026-09-18 实测，别再试 arm64）
#
#   x86_64 宿主机上的 Android 模拟器**不支持 arm64 系统镜像**，不是"慢"，
#   是直接拒绝启动：
#
#     FATAL | Avd's CPU Architecture 'arm64' is not supported by the QEMU2
#             emulator on x86_64 host. System image must match the host
#             architecture.
#
#   而本机 `emulator -accel-check` 显示 WHPX 10.0.26100 可用 —— 但那只能加速
#   **x86/x86_64** 镜像，对 arm64 无济于事。
#
#   后果：ADR-009 决定"只发布 arm64-v8a"，所以**发布包在模拟器上装不了**。
#   可行的分工是：
#
#     模拟器测试 → 用 x86_64 镜像 + **本地临时的 x86_64 debug 构建**
#                   （tauri android dev/build --target x86_64；WHPX 加速，很快）
#                   这份 x86_64 包**只用于本地调试，绝不进发布产物**
#     arm64 真实行为（音频/性能/ABI 相关） → 只能靠真机
#
#   这样既满足"用虚拟机测"，又不违反"发布只出 arm64"。
# ════════════════════════════════════════════════════════════════════════════
param(
    [ValidateSet("x86_64", "arm64-v8a")]
    [string]$Abi = "x86_64",
    [string]$Api = "35",
    [string]$Name,
    [switch]$List
)

$ErrorActionPreference = "Stop"

$env:JAVA_HOME = "D:\Download\_tools\jdk-17"
$Sdk = "D:\Android\Sdk"
$AvdManager = "$Sdk\cmdline-tools\latest\bin\avdmanager.bat"
$SdkManager = "$Sdk\cmdline-tools\latest\bin\sdkmanager.bat"

if (-not (Test-Path $AvdManager)) { throw "找不到 avdmanager: $AvdManager" }

if ($Abi -eq "arm64-v8a") {
    Write-Host "⚠️ arm64 镜像在 x86_64 宿主上无法启动（见本脚本头部说明）。" -ForegroundColor Yellow
    Write-Host "   若你确实要建，请确认宿主是 Windows on ARM。" -ForegroundColor Yellow
}

$image = "system-images;android-$Api;google_apis;$Abi"

# 三种屏型，括号内为等效 CSS 尺寸（物理 / (dpi/160)）
$profiles = @(
    @{ Name = "hs-phone-small"; Device = "pixel";        W = 720;  H = 1280; Dpi = 320 }  # 360x640  CSS  phone
    @{ Name = "hs-phone-tall";  Device = "pixel_7";      W = 1080; H = 2400; Dpi = 480 }  # 360x800  CSS  phone
    @{ Name = "hs-tablet";      Device = "pixel_tablet"; W = 1600; H = 2560; Dpi = 320 }  # 800x1280 CSS  tablet
)

if ($List) {
    Write-Host "ABI       = $Abi"
    Write-Host "需要的镜像 = $image"
    Write-Host "`n已安装的 system-image："
    & $SdkManager --list_installed 2>&1 | Select-String "system-images" |
        ForEach-Object { Write-Host "  $_" }
    Write-Host "`n已有 AVD："
    & $AvdManager list avd 2>&1 | Select-String "Name:|Based on:" |
        ForEach-Object { Write-Host "  $_" }
    exit 0
}

# ── 1. 装镜像 ───────────────────────────────────────────────────────────────
$dir = "$Sdk\system-images\android-$Api\google_apis\$Abi"
if (Test-Path $dir) {
    Write-Host "镜像已存在：$image"
} else {
    Write-Host "下载镜像 $image（x86_64 约 0.8 GB，arm64 约 1.5 GB）..." -ForegroundColor Yellow
    ("y`n" * 40) | & $SdkManager --install $image
}

# ── 2. 建 AVD ───────────────────────────────────────────────────────────────
foreach ($p in $profiles) {
    $avdName = if ($Name) { $Name } else { $p.Name }

    $existing = & $AvdManager list avd 2>&1 | Select-String "Name: $avdName"
    if ($existing) {
        Write-Host "AVD 已存在：$avdName"
    } else {
        Write-Host "创建 AVD：$avdName （$($p.W)x$($p.H) @ $($p.Dpi)dpi）"
        "no" | & $AvdManager create avd -n $avdName -k $image -d $p.Device --force
    }

    # 覆盖分辨率与密度（docs/04 §2 的断点按 CSS px 判定，所以必须精确控制）
    $cfg = "$env:USERPROFILE\.android\avd\$avdName.avd\config.ini"
    if (Test-Path $cfg) {
        $lines = Get-Content $cfg | Where-Object {
            $_ -notmatch '^hw\.lcd\.(width|height|density)=' -and
            $_ -notmatch '^hw\.keyboard=' -and
            $_ -notmatch '^skin\.'
        }
        $lines += "hw.lcd.width=$($p.W)"
        $lines += "hw.lcd.height=$($p.H)"
        $lines += "hw.lcd.density=$($p.Dpi)"
        # 强制软键盘：手机没有物理键盘，这会影响 window resize 行为
        $lines += "hw.keyboard=no"
        $lines += "skin.dynamic=yes"
        $lines | Set-Content $cfg -Encoding ASCII
        $cssW = [math]::Round($p.W / ($p.Dpi / 160))
        $cssH = [math]::Round($p.H / ($p.Dpi / 160))
        Write-Host "  已覆盖分辨率：等效 CSS ${cssW}x${cssH} px" -ForegroundColor Green
    }

    if ($Name) { break }
}

# ── 3. 启动提示 ─────────────────────────────────────────────────────────────
Write-Host "`n启动方式：" -ForegroundColor Cyan
foreach ($p in $profiles) {
    $n = if ($Name) { $Name } else { $p.Name }
    Write-Host "  D:/Android/Sdk/emulator/emulator.exe -avd $n -no-snapshot-load -no-boot-anim -gpu swiftshader_indirect"
    if ($Name) { break }
}
Write-Host "`n配合 x86_64 镜像，Tauri 侧要显式出 x86_64："
Write-Host "  npx tauri android dev   --target x86_64     # 仅供本地调试" -ForegroundColor Gray
Write-Host "  npx tauri android build --target aarch64    # 发布用" -ForegroundColor Gray
