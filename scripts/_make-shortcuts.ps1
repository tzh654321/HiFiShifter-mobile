<#
  _make-shortcuts.ps1 —— 在桌面创建「打开测试机」的快捷方式。

  为什么要用脚本建：`.lnk` 没法手工写（是 COM 结构化存储），只能走
  WScript.Shell COM。中文名的编码要靠本文件的 UTF-8 BOM 保证
  （PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI/GBK 解，中文会乱码）。
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ps1 = Join-Path $root 'scripts\launch-testvm.ps1'
$emu = 'D:\Android\Sdk\emulator\emulator.exe'
$desktop = [Environment]::GetFolderPath('Desktop')

if (-not (Test-Path $ps1)) { throw "找不到 $ps1" }

$wsh = New-Object -ComObject WScript.Shell

function New-VmShortcut {
    param(
        [string]$Name,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$IconPath,
        [string]$Description
    )
    $path = Join-Path $desktop "$Name.lnk"
    $sc = $wsh.CreateShortcut($path)
    $sc.TargetPath = $TargetPath
    $sc.Arguments = $Arguments
    $sc.WorkingDirectory = $root
    if ($IconPath) { $sc.IconLocation = $IconPath }
    $sc.Description = $Description
    $sc.WindowStyle = 1
    $sc.Save()
    return $path
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$made = @()

$made += New-VmShortcut -Name '测试机 - 手机(360x800)' `
    -TargetPath $psExe `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`" -Profile phone" `
    -IconPath $emu `
    -Description '启动 Android 测试机（模拟器 hs-phone-tall），视口 360x800 CSS px'

$made += New-VmShortcut -Name '测试机 - 平板(800x1280)' `
    -TargetPath $psExe `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`" -Profile tablet" `
    -IconPath $emu `
    -Description '启动 Android 测试机并切到平板视口 800x1280 CSS px（用于三套布局验收）'

$made += New-VmShortcut -Name '测试机 - 桌面(1706x1066)' `
    -TargetPath $psExe `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`" -Profile desktop" `
    -IconPath $emu `
    -Description '启动 Android 测试机并切到桌面视口 1706x1066 CSS px'

$made | ForEach-Object { Write-Host "OK  $_" }
