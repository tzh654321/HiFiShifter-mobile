<#
  clean-disk.ps1 —— 白名单式磁盘清理。**默认只报告，不动任何文件**。

  为什么需要它：WorkBuddy 里 AI 执行的每一次删除（Bash 的 `rm`、PowerShell 的 `Remove-Item`）
  都会被 safe-delete 垫片送进**回收站**，于是回收站越攒越多（实测 C: 1661 个 / 176 MB，
  D: 4901 个 / 709 MB）。而"真正释放空间"必须清空回收站。

  这个脚本把「清理」交回给**你自己**：
    · 只动**白名单**里的目录，绝不碰 桌面 / 下载 / 文档 / 家目录（整条路径前缀硬编码校验）
    · **默认 -DryRun**：只列出「会删什么、能省多少」，不动一个文件
    · 加 `-Apply` 才真删，且删前再打印一次摘要
    · 不碰回收站；清空回收站请单独用 `-EmptyRecycleBin`（那是不可恢复的）

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\clean-disk.ps1
    powershell ... -File scripts\clean-disk.ps1 -Apply
    powershell ... -File scripts\clean-disk.ps1 -Apply -EmptyRecycleBin
    powershell ... -File scripts\clean-disk.ps1 -TempOlderThanDays 1 -Apply

  实测占用参考（2026-09-20）：%TEMP% 11 GB、~/.android 8.4 GB、回收站 885 MB。
#>
[CmdletBinding()]
param(
    # 真删。不加则只报告。
    [switch]$Apply,
    # 一并清空回收站（**不可恢复**，且会清掉 C:/D: 两个盘）
    [switch]$EmptyRecycleBin,
    # %TEMP% 里只清「最后写入早于 N 天」的文件（默认 7 天，避免误删正在跑的东西）
    [int]$TempOlderThanDays = 7,
    # 单个文件小于此值不删（避免把大量零碎小文件也卷进来）
    [int]$MinFileMB = 1
)

$ErrorActionPreference = 'Continue'
$now = Get-Date
$cutoff = $now.AddDays(-$TempOlderThanDays)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Format-MB([double]$bytes) { '{0,10:N1} MB' -f ($bytes / 1MB) }

# ── 白名单：只有这些前缀下的东西才允许被删 ────────────────────────────────
# ⚠️ 这里刻意**不含** 桌面 / 下载 / 文档 / 家目录根。
$allowedRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Temp'),
    (Join-Path $root 'upstream-src\backend\src-tauri\gen\android\app\build'),
    (Join-Path $root 'upstream-src\backend\src-tauri\gen\android\build'),
    (Join-Path $root 'upstream-src\frontend\node_modules\.vite'),
    'D:\gradle-home\caches\8.14.3\transforms',
    'D:\gradle-home\caches\8.14.3\kotlin-dsl',
    'D:\hfshifter-target-upstream\debug\incremental'
)

function Test-Allowed([string]$path) {
    $p = [IO.Path]::GetFullPath($path)
    if ($p -match '\.\.') { return $false }
    foreach ($r in $allowedRoots) {
        $rf = [IO.Path]::GetFullPath($r).TrimEnd('\')
        # ⚠️ 必须先判「等于白名单根本身」：目录级的清理项就是根自己，
        # 只写 StartsWith($rf + '\') 会把它自己判掉 —— 实测踩到（构建目录整栏消失）。
        if ($p.Equals($rf, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if ($p.StartsWith($rf + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

# 不用 (Get-PSDrive C).Free：嵌套 powershell / 受限会话里可能取到 $null（实测显示成 0 MB）
function Get-FreeMB([string]$drive) {
    try { return [math]::Round((New-Object IO.DriveInfo($drive)).AvailableFreeSpace / 1MB) }
    catch { return -1 }
}

Write-Host ''
Write-Host '=== 磁盘清理（白名单模式）===' -ForegroundColor Cyan
if (-not $Apply) { Write-Host '当前是「只报告」模式，不会删除任何文件。加 -Apply 才真删。' -ForegroundColor Yellow }
Write-Host ("C: 可用 {0:N0} MB" -f (Get-FreeMB 'C'))
Write-Host ''

$plan = New-Object System.Collections.Generic.List[object]

# ── 1. %TEMP% 里「够老 + 够大」的文件 ──────────────────────────────────────
$temp = Join-Path $env:LOCALAPPDATA 'Temp'
if (Test-Path -LiteralPath $temp) {
    Write-Host "扫描 $temp（老于 $TempOlderThanDays 天、单个 > $MinFileMB MB）..." -ForegroundColor DarkGray
    $files = Get-ChildItem -LiteralPath $temp -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff -and $_.Length -gt ($MinFileMB * 1MB) }
    foreach ($f in $files) {
        if (Test-Allowed $f.FullName) {
            $plan.Add([pscustomobject]@{ Path = $f.FullName; Bytes = $f.Length; Kind = 'TEMP 陈旧文件' })
        }
    }
}

# ── 2. 项目 / Gradle 的构建中间产物（整目录，可再生）─────────────────────
$dirs = @(
    (Join-Path $root 'upstream-src\backend\src-tauri\gen\android\app\build'),
    (Join-Path $root 'upstream-src\backend\src-tauri\gen\android\build'),
    (Join-Path $root 'upstream-src\frontend\node_modules\.vite'),
    'D:\gradle-home\caches\8.14.3\transforms',
    'D:\gradle-home\caches\8.14.3\kotlin-dsl',
    'D:\hfshifter-target-upstream\debug\incremental'
)
foreach ($d in $dirs) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    if (-not (Test-Allowed $d)) { continue }
    $sum = (Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
    if (-not $sum) { $sum = 0 }
    $plan.Add([pscustomobject]@{ Path = $d; Bytes = $sum; Kind = '构建中间产物（可再生）' })
}

# ── 报告 ────────────────────────────────────────────────────────────────
Write-Host ''
if ($plan.Count -eq 0) {
    Write-Host '没有命中白名单里的可清理项。' -ForegroundColor Green
} else {
    Write-Host ("将清理 {0} 项，合计约 {1}：" -f $plan.Count, (Format-MB (($plan | Measure-Object -Property Bytes -Sum).Sum))) -ForegroundColor Cyan
    $plan | Sort-Object Bytes -Descending | ForEach-Object {
        Write-Host ("  {0}  [{1}]  {2}" -f (Format-MB $_.Bytes), $_.Kind, $_.Path)
    }
}

# ── 执行 ────────────────────────────────────────────────────────────────
if ($Apply -and $plan.Count -gt 0) {
    Write-Host ''
    Write-Host '开始删除（白名单内，直接永久删除，不进回收站）...' -ForegroundColor Yellow
    $ok = 0; $fail = 0
    foreach ($item in $plan) {
        # 再校验一次：执行前也要在白名单内
        if (-not (Test-Allowed $item.Path)) { Write-Host "  跳过（不在白名单）$($item.Path)" -ForegroundColor Red; continue }
        try {
            if (Test-Path -LiteralPath $item.Path -PathType Container) {
                Remove-Item -LiteralPath $item.Path -Recurse -Force -ErrorAction Stop
            } else {
                Remove-Item -LiteralPath $item.Path -Force -ErrorAction Stop
            }
            $ok++
        } catch {
            # 「被占用」是正常的：模拟器/Gradle 守护进程正在用其中的文件
            $fail++
            Write-Host ("  失败（多为被占用，可先关模拟器/Gradle 再跑）: {0}" -f $item.Path) -ForegroundColor DarkYellow
        }
    }
    Write-Host "完成：成功 $ok 项，失败 $fail 项。" -ForegroundColor Green
}

# ── 回收站 ──────────────────────────────────────────────────────────────
if ($EmptyRecycleBin) {
    Write-Host ''
    Write-Host '清空回收站（C:/D:，不可恢复）...' -ForegroundColor Yellow
    Clear-RecycleBin -Force -Confirm:$false -ErrorAction Continue
    Write-Host '已提交清空。注意：释放是异步的，文件系统数字可能几分钟后才更新。' -ForegroundColor DarkGray
} elseif (-not $Apply) {
    Write-Host ''
    Write-Host '提示：回收站里的东西只有清空才真正释放空间。要一并清空请加 -EmptyRecycleBin（不可恢复）。' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host ("C: 可用 {0:N0} MB" -f (Get-FreeMB 'C'))
Write-Host ''
