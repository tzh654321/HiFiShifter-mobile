<#
  launch-testvm.ps1 —— 一键启动 Android 测试机（模拟器）+ 按形态切好视口。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch-testvm.ps1
    powershell ... -File scripts\launch-testvm.ps1 -Profile tablet
    powershell ... -File scripts\launch-testvm.ps1 -Profile desktop
    powershell ... -File scripts\launch-testvm.ps1 -NoViewport     # 只开机器，不动视口

  三套布局的视口（CSS px = 物理 / (dpi/160)）：
    phone    1080x2400 @480  →  360 x  800
    tablet   1600x2560 @320  →  800 x 1280
    desktop  2560x1600 @240  → 1706 x 1066

  ⚠️ 为什么平板要靠 `wm size`/`wm density` 而不是另开一台 AVD：
     本机 `hs-tablet`（以及用 Nexus 10 全新创建的 `hs-tablet2`）都会在 qemu 启动瞬间
     **静默退出**、无任何错误输出；而 `hs-phone-tall` 稳定启动。所以统一用同一台 AVD
     改逻辑分辨率来等价模拟三种形态。

  ⚠️ `wm density` 变化会被 Android 当成配置变更，**把前台应用杀掉** ——
     所以脚本的顺序是「先切视口 → 再启动应用」。
#>
[CmdletBinding()]
param(
    [ValidateSet('phone', 'tablet', 'desktop')]
    [string]$Profile = 'phone',
    [string]$Avd = 'hs-phone-tall',
    [switch]$NoViewport,
    [switch]$NoApp
)

$ErrorActionPreference = 'Continue'

$Sdk = 'D:\Android\Sdk'
$Emu = Join-Path $Sdk 'emulator\emulator.exe'
$Adb = Join-Path $Sdk 'platform-tools\adb.exe'
$Pkg = 'com.arounder.hifishifter'

foreach ($p in @($Emu, $Adb)) {
    if (-not (Test-Path $p)) { Write-Host "[x] 找不到 $p" -ForegroundColor Red; exit 1 }
}

$viewport = @{
    phone   = @{ Size = $null;       Dpi = $null }   # 还原物理值
    tablet  = @{ Size = '1600x2560'; Dpi = '320' }
    desktop = @{ Size = '2560x1600'; Dpi = '240' }
}[$Profile]

# ── 1. 记录启动前已有的设备，便于识别「新起来的那台」────────────────────────
$before = @(& $Adb devices | Select-Object -Skip 1 |
    Where-Object { $_ -match '\tdevice$' } | ForEach-Object { ($_ -split '\t')[0] })

Write-Host ''
Write-Host "=== HiFiShifter 测试机 : $Avd ($Profile) ===" -ForegroundColor Cyan
Write-Host "[1/4] 启动模拟器 ..."
Start-Process -FilePath $Emu -ArgumentList @(
    '-avd', $Avd, '-no-snapshot', '-gpu', 'swiftshader_indirect', '-no-boot-anim'
) | Out-Null

# ── 2. 等新设备出现 ─────────────────────────────────────────────────────────
Write-Host "[2/4] 等待设备上线（首次冷启动约 30-60 秒）..."
$serial = $null
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    $now = @(& $Adb devices | Select-Object -Skip 1 |
        Where-Object { $_ -match '\tdevice$' } | ForEach-Object { ($_ -split '\t')[0] })
    $new = $now | Where-Object { $before -notcontains $_ }
    if ($new) { $serial = @($new)[0]; break }
    if ($now.Count -gt 0 -and $before.Count -eq 0) { $serial = @($now)[0]; break }
}
if (-not $serial) {
    Write-Host "[!] 90 秒内没看到设备。若模拟器窗口已出现，可稍等后手动继续。" -ForegroundColor Yellow
    Write-Host "    （已知现象：C 盘空间不足时 qemu 会秒退；先清空回收站再试）" -ForegroundColor Yellow
    exit 1
}
Write-Host "      设备 = $serial"

# ── 3. 等开机完成 ───────────────────────────────────────────────────────────
Write-Host "[3/4] 等待开机完成 ..."
for ($i = 0; $i -lt 120; $i++) {
    $done = (& $Adb -s $serial shell getprop sys.boot_completed 2>$null) -replace '\s', ''
    if ($done -eq '1') { break }
    Start-Sleep -Seconds 2
}
& $Adb -s $serial shell svc power stayon true | Out-Null

# ── 4. 切视口 → 再起应用 ────────────────────────────────────────────────────
if (-not $NoViewport) {
    if ($viewport.Size) {
        Write-Host "[4/4] 切到 $Profile 视口：$($viewport.Size) @$($viewport.Dpi)dpi"
        & $Adb -s $serial shell wm size $viewport.Size | Out-Null
        & $Adb -s $serial shell wm density $viewport.Dpi | Out-Null
    }
    else {
        Write-Host "[4/4] 还原物理分辨率（phone 原生值）"
        & $Adb -s $serial shell wm size reset | Out-Null
        & $Adb -s $serial shell wm density reset | Out-Null
    }
    Start-Sleep -Seconds 3
}

if (-not $NoApp) {
    $installed = (& $Adb -s $serial shell pm list packages $Pkg 2>$null) -match $Pkg
    if ($installed) {
        & $Adb -s $serial shell am force-stop $Pkg | Out-Null
        Start-Sleep -Seconds 1
        & $Adb -s $serial shell am start -n "$Pkg/.MainActivity" | Out-Null
        Write-Host "      已启动 $Pkg"
    }
    else {
        Write-Host "      [i] 还没装 $Pkg —— 装一次即可（自动装到唯一在线的设备）：" -ForegroundColor DarkGray
        Write-Host "          adb -s $serial install -r -t dist\hifishifter-x86_64-tablet.apk" -ForegroundColor DarkGray
    }
}

$sz = (& $Adb -s $serial shell wm size) -join ' '
$dp = (& $Adb -s $serial shell wm density) -join ' '
Write-Host ''
Write-Host "完成。$sz  |  $dp" -ForegroundColor Green
Write-Host "接下来："
Write-Host "  · 装/换包：adb -s $serial install -r -t <apk>"
Write-Host "  · 排版审计：bash scripts/profile-audit.sh $Profile"
Write-Host "  · CDP 验收：node scripts/probe-ui.mjs --serial $serial dump"
Write-Host ''
Write-Host "这个窗口可以直接关掉（模拟器是独立进程）。" -ForegroundColor DarkGray
