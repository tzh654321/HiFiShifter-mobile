#Requires -Version 5.1
<#
  把「临时目录」指到 D:，避免构建/安装过程把 C 盘写满。

  ── 为什么只改当前用户，不改机器级 ────────────────────────────────────────────
  进程的环境块 = 机器级变量 → 再被用户级变量**覆盖**。所以只要设好用户级，
  你启动的所有程序（资源管理器拉起的终端、编辑器、构建工具）都会拿到 D:，
  **不需要管理员权限**，也不影响以 SYSTEM 运行的服务。

  机器级（`C:\windows\TEMP`）**故意不动**：服务在开机早期就可能用到它，
  而 D: 若因任何原因不可用（分区挂载慢、盘被拔），所有服务会一起出问题。
  这是 Windows 的默认安排，没有理由去动它。

  ── 用法 ────────────────────────────────────────────────────────────────────
  只报告（不改任何东西）：
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-temp-d.ps1 -WhatIf

  真的改（当前用户）：
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-temp-d.ps1

  换个别的位置：
      ... -File scripts\set-temp-d.ps1 -TempDir 'D:\Build\tmp'

  ⚠️ 改完之后，**已经在运行的程序仍用旧值**（Windows 不会回溯改已存在的进程）。
     要真正全局生效，重启 WorkBuddy / 终端；或者注销重登。
#>
param(
    [string]$TempDir = 'D:\Temp',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$names = @('TEMP', 'TMP', 'TMPDIR')

function Show-State([string]$title) {
    Write-Host ''
    Write-Host "── $title ──"
    foreach ($n in $names) {
        $u = [Environment]::GetEnvironmentVariable($n, 'User')
        $m = [Environment]::GetEnvironmentVariable($n, 'Machine')
        $p = [Environment]::GetEnvironmentVariable($n, 'Process')
        Write-Host ("  {0,-7} 用户=[{1}] 机器=[{2}] 本进程=[{3}]" -f $n, $u, $m, $p)
    }
}

Show-State '改之前'

if ($WhatIf) {
    Write-Host ''
    Write-Host "（-WhatIf：只报告，不修改。目标 = $TempDir）" -ForegroundColor Yellow
    exit 0
}

# 1) 目标目录必须存在且可写
if (-not (Test-Path -LiteralPath $TempDir)) {
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    Write-Host "已创建 $TempDir"
}
$probe = Join-Path $TempDir ('.w-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII
    Remove-Item -LiteralPath $probe -Force
} catch {
    throw "目标目录不可写：$TempDir —— $($_.Exception.Message)"
}

# 2) 写用户级变量（不需要管理员；.NET 会广播 WM_SETTINGCHANGE）
foreach ($n in $names) {
    [Environment]::SetEnvironmentVariable($n, $TempDir, 'User')
}

Show-State '改之后（"本进程"仍是旧值，属正常）'
Write-Host ''
Write-Host "OK  用户级 TEMP/TMP/TMPDIR 已指向 $TempDir" -ForegroundColor Green
Write-Host '    机器级未改动（以 SYSTEM 运行的服务继续用 C:\windows\TEMP，这是刻意的）。'
Write-Host '注意：重启 WorkBuddy / 终端后新进程才会生效。'
