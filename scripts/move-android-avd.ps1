#Requires -Version 5.1
<#
    把 Android 的 AVD 目录从 C: 搬到 D:，释放 C 盘空间。

    ── 为什么 ────────────────────────────────────────────────────────────────
    C:\Users\<你>\.android\avd 目前 **8.2 GB**（几乎全是 hs-phone-tall 的系统/用户镜像），
    是 C 盘剩下的少数几个大户之一。AVD 是**纯派生物**（大不了重建），搬走后用环境变量
    ANDROID_AVD_HOME 指过去即可，模拟器的行为完全不变。

    ── 两个必须处理的坑 ──────────────────────────────────────────────────────
    1. **模拟器运行中不能搬**：镜像文件被 qemu 独占，复制出来是坏的。本脚本会先检测
       （`-Force` 可跳过检测，不建议）。
    2. **AVD 的 .ini 里写死了绝对路径**：`path=C:\Users\...\.android\avd\xxx.avd`。
       只搬目录不改它，emulator 会找不到 AVD。所以复制完必须把 `path=` 改写成新位置
       （`path.rel=` 是相对路径，保持原样即可）。改写前会备份成 `*.ini.bak`。

    ── 安全设计（与 scripts/clean-disk.ps1 同口径）──────────────────────────
      · 默认**只复制 + 校验**，一个字节都不删；
      · `-RemoveSource` 才删源，且**校验不通过就拒绝删**；
      · 删除走回收站（Remove-Item），不是永久删除；
      · 可反复执行：robocopy 是增量的，已复制过的会跳过。

    ── ⚠️ 最容易误解的一点：回收站不释放空间 ──────────────────────────────────
    `-RemoveSource` 把 11 GB 丢进**回收站**，文件仍在 C: 上 ⇒ **`df /c` 一个大字节都不会变**
    （上一轮就是这样：以为"没删"，其实是"删了但没释放"）。
    真正腾出空间必须**清空回收站**，而那一步只有用户能在自己终端里跑：

      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\clean-disk.ps1 -EmptyRecycleBin

    或者 `robocopy /MOVE`（它的删除是直接 unlink、不进回收站）——见文末备注。

    ── 用法 ──────────────────────────────────────────────────────────────────
      # 第一步：复制 + 校验（模拟器要先关掉）
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\move-android-avd.ps1

      # 第二步：看到"校验通过"之后再删源
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\move-android-avd.ps1 -RemoveSource

      # 只想清掉那两个空壳 AVD（hs-tablet / hs-tablet2），可以加 -PurgeDead
#>
[CmdletBinding()]
param(
    [string]$Source = "$env:USERPROFILE\.android\avd",
    [string]$Target = 'D:\android-avd',
    [switch]$RemoveSource,
    [switch]$PurgeDead,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Report = @()

function Save-Report {
    # ⚠️ 先落盘再 `exit`：`exit` 会丢弃还没刷出的输出（实测 —— 早退时调用方
    #    一个字节都收不到）。所以每条退出路径都必须先经过这里。
    $path = Join-Path (Split-Path $Target -Parent) 'android-avd-move-report.txt'
    ($script:Report -join "`n") | Set-Content -LiteralPath $path -Encoding UTF8
    return $path
}
function Say  { param($m, $c = 'Gray')    Write-Host "  $m" -ForegroundColor $c; $script:Report += "  $m" }
function Step { param($m)                 Write-Host ''; Write-Host "── $m ──" -ForegroundColor Cyan; $script:Report += "`n── $m ──" }
function Die  {
    param($m)
    Write-Host "  ✗ $m" -ForegroundColor Red
    $script:Report += "  ✗ $m"
    $p = Save-Report
    Write-Host ''
    Write-Host "报告已写入：$p" -ForegroundColor DarkGray
    exit 1
}

Write-Host ''
Write-Host '把 Android AVD 从 C: 搬到 D:' -ForegroundColor White
Say "源  : $Source"
Say "目标: $Target"

# ── ① 前置检查 ─────────────────────────────────────────────────────────────
Step '① 前置检查'

if (-not (Test-Path -LiteralPath $Source)) { Die "源目录不存在：$Source" }
Say "✓ 源目录存在" 'Green'

# 模拟器在跑吗？qemu/emulator 会独占镜像文件（memory 里的原话：文件被锁时复制出来是坏的）
$emu = @(Get-Process -Name 'emulator*', 'qemu*', 'qemu-system*' -ErrorAction SilentlyContinue)
if ($emu.Count -gt 0 -and -not $Force) {
    Die ("模拟器正在运行（$($emu.Count) 个进程），镜像被独占，现在复制会得到坏文件。`n" +
         "     请先关掉：adb -s emulator-5554 emu kill   （或直接关模拟器窗口）`n" +
         "     确实要跳过检测就加 -Force，但**不推荐**。")
}
if ($emu.Count -gt 0) { Say "⚠ 模拟器在运行，但指定了 -Force，继续（复制结果可能不可用）" 'Yellow' }
else { Say '✓ 没有模拟器进程占用' 'Green' }

# 源有多大 / D 盘放得下吗
$srcFiles = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force)
$srcBytes = ($srcFiles | Measure-Object -Property Length -Sum).Sum
$srcMB = [math]::Round($srcBytes / 1MB, 1)
Say "源大小：$srcMB MB（$($srcFiles.Count) 个文件）"

$dFree = (Get-PSDrive -Name D).Free
$dFreeMB = [math]::Round($dFree / 1MB, 1)
Say "D 盘可用：$dFreeMB MB"
if ($dFree -lt $srcBytes * 1.1) {
    Die "D 盘空间不足（需要约 $([math]::Round($srcBytes * 1.1 / 1MB)) MB，只有 $dFreeMB MB）"
}
Say '✓ 空间充足' 'Green'

# ── ② 复制 ─────────────────────────────────────────────────────────────────
Step '② 复制到 D:（robocopy 增量，可反复执行）'
New-Item -ItemType Directory -Force -Path $Target | Out-Null

# /E 含空目录；/COPY:DAT 复制数据+属性+时间戳（不要 ACL，避免非管理员被拒）
# /R:2 /W:1 失败重试 2 次、等 1 秒，避免卡死在长重试上
$rc = 0
& robocopy $Source $Target /E /COPY:DAT /R:2 /W:1 /NFL /NDL /NP /NJH | Out-Null
$rc = $LASTEXITCODE
# robocopy 的约定：0–7 都算成功（1=有文件被复制，2=有额外文件，3=1+2 …），≥8 才是真失败
if ($rc -ge 8) { Die "robocopy 失败（退出码 $rc）" }
Say "✓ 复制完成（robocopy 退出码 $rc，≤7 均属成功）" 'Green'

# ── ③ 改写 .ini 里写死的绝对路径 ───────────────────────────────────────────
Step '③ 改写 AVD 配置里的绝对路径（不改的话模拟器找不到 AVD）'
$iniCount = 0
foreach ($ini in (Get-ChildItem -LiteralPath $Target -Filter '*.ini' -File)) {
    $text = Get-Content -LiteralPath $ini.FullName -Raw -Encoding UTF8
    if ($text -notmatch '(?m)^path=') { continue }

    $old = ($text -split "`n" | Where-Object { $_ -match '^path=' }) -join ''
    # 把 `path=` 后的绝对路径重建到新目录：<Target>\<avd 名>.avd
    $avdName = [IO.Path]::GetFileNameWithoutExtension($ini.Name) + '.avd'
    $newPath = Join-Path $Target $avdName
    $new = [regex]::Replace($text, '(?m)^path=.*$', "path=$newPath")

    if ($new -ne $text) {
        if (-not (Test-Path "$($ini.FullName).bak")) {
            Copy-Item -LiteralPath $ini.FullName -Destination "$($ini.FullName).bak"
        }
        Set-Content -LiteralPath $ini.FullName -Value $new -Encoding UTF8 -NoNewline
        Say "  ✓ $($ini.Name)：$($old.Trim()) → path=$newPath" 'Green'
        $iniCount++
    } else {
        Say "  · $($ini.Name)：已是新路径，跳过"
    }
}
Say "共改写 $iniCount 个 .ini（原件已备份为 *.ini.bak）"

# ── ④ 校验 ─────────────────────────────────────────────────────────────────
Step '④ 校验（文件数 + 总字节数必须一致）'
# ⚠️ **必须排除 `*.ini` 与 `*.ini.bak`** —— 它们是本脚本**故意改写/生成**的文件：
#    · step ③ 用 `Set-Content -Encoding UTF8` 改写 `path=`，PS 5.1 会给它加 **3 字节 BOM**
#      ⇒ 目标 .ini 天生与源不同（实测差 32 字节）；
#    · **重跑时目标 .ini 早已是新路径** ⇒ 只要算进比对，校验**永远不可能通过**，
#      `$verified` 永远 false ⇒ `-RemoveSource` 必然 `Die '拒绝删除源目录'` ⇒ **源永远删不掉**。
#      （2026-09-27 实测连栽两次：先 74 vs 78 / 差 440，再 74 vs 74 / 差 32。）
#    取而代之：对 .ini 单独断言「path= 已指向新目录」—— 这才是真正要保证的事。
#    ⚠️ 排除范围**只能是顶层的 `<名字>.ini`**：`.avd\` 目录里还有 `config.ini`、
#       `hardware-qemu.ini`（后者 ~20 KB），它们是**正常数据**，被误排过一次（差 13 个文件 / 20141 字节）。
$cmpSrc = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force |
            Where-Object { $_.Name -notlike '*.ini.bak' -and
                           -not ($_.Extension -eq '.ini' -and $_.DirectoryName -eq $Source) })
$cmpDst = @(Get-ChildItem -LiteralPath $Target -Recurse -File -Force |
            Where-Object { $_.Name -notlike '*.ini.bak' -and
                           -not ($_.Extension -eq '.ini' -and $_.DirectoryName -eq $Target) })
$srcCmpBytes = ($cmpSrc | Measure-Object -Property Length -Sum).Sum
$dstBytes = ($cmpDst | Measure-Object -Property Length -Sum).Sum

$iniBad = @()
foreach ($ini in (Get-ChildItem -LiteralPath $Target -Filter '*.ini' -File)) {
    $t = Get-Content -LiteralPath $ini.FullName -Raw
    if ($t -notmatch [regex]::Escape("path=$Target")) { $iniBad += $ini.Name }
}

Say '（顶层 .ini / *.ini.bak 是脚本故意改写的，已排除出字节比对，改为单独断言）'
Say "源  ：$($cmpSrc.Count) 个文件 / $([math]::Round($srcCmpBytes / 1MB, 1)) MB（总 $($srcFiles.Count) 个 / $srcMB MB）"
Say "目标：$($cmpDst.Count) 个文件 / $([math]::Round($dstBytes / 1MB, 1)) MB"
if ($iniBad.Count -eq 0) { Say '✓ 所有顶层 .ini 的 path= 都指向新目录' 'Green' }
else { Say "✗ 这些 .ini 的 path= 没指到新目录：$($iniBad -join ', ')" 'Red' }

$verified = $false
if ($cmpDst.Count -eq $cmpSrc.Count -and $dstBytes -eq $srcCmpBytes -and $iniBad.Count -eq 0) {
    Say '✓ 校验通过：文件数与字节数完全一致，且 .ini 全部指向新目录' 'Green'
    $verified = $true
} else {
    Say '✗ 校验不通过' 'Red'
    if ($cmpDst.Count -ne $cmpSrc.Count) {
        Say "  文件数差 $($cmpSrc.Count - $cmpDst.Count)（源 $($cmpSrc.Count) / 目标 $($cmpDst.Count)）" 'Red'
    }
    if ($dstBytes -ne $srcCmpBytes) {
        Say "  字节数差 $($srcCmpBytes - $dstBytes)（源 $srcCmpBytes / 目标 $dstBytes）" 'Red'
    }
    if ($iniBad.Count -ne 0) { Say "  .ini 未指向新目录：$($iniBad -join ', ')" 'Red' }
    if ($RemoveSource) { Die '校验没过，**拒绝删除源目录**（源还是完整的，请排查后重跑）' }
    Say '  源目录保持不动。请排查后重跑本脚本（robocopy 是增量的）。' 'Yellow'
}

# ── ⑤ 环境变量 ─────────────────────────────────────────────────────────────
Step '⑤ 设置 ANDROID_AVD_HOME'
$cur = [Environment]::GetEnvironmentVariable('ANDROID_AVD_HOME', 'User')
if ($cur -eq $Target) {
    Say "· 已是 $Target，跳过"
} else {
    [Environment]::SetEnvironmentVariable('ANDROID_AVD_HOME', $Target, 'User')
    Say "✓ 已设为 $Target（用户级）" 'Green'
    Say '  ⚠ 对**已经在跑**的进程不生效（环境块启动时定型）—— 新开的终端/模拟器才会读到。'
    Say '    项目侧另有兜底：scripts/android-env.sh 会显式导出这个变量。' 'Yellow'
}

# ── ⑥ 可选：删除源 ─────────────────────────────────────────────────────────
if ($RemoveSource) {
    Step '⑥ 删除源目录（走回收站）'
    if (-not $verified) { Die '校验没通过，拒绝删除' }
    if (-not $Force) {
        Say '即将删除：' 'Yellow'
        Say "  C 盘：$Source（$srcMB MB）" 'Yellow'
        Say '继续请在 10 秒内按 Ctrl+C 中断…' 'Yellow'
        Start-Sleep -Seconds 10
    }
    Remove-Item -LiteralPath $Source -Recurse -Force
    Say "✓ 已删除源目录（进回收站；确认模拟器能正常启动后再清空回收站）" 'Green'
} else {
    Step '⑥ 删除源目录（未启用）'
    Say '默认**不删**。确认下面两步之后，再加 -RemoveSource 重跑：' 'Yellow'
    Say '  1) 用 AVD Manager 或 emulator -avd hs-phone-tall 能正常启动'
    Say '  2) D 盘上的镜像确实可用（进得去系统、能装 APK）'
}

# ── 报告 ───────────────────────────────────────────────────────────────────
# ⚠️ 这里原来是一句光秃秃的 `Done` —— 那不是函数、是**不存在的命令**，
#    在 `$ErrorActionPreference='Stop'` 下会抛 CommandNotFoundException 直接退出
#    （实测：活儿全干完了，却报错退出、最后的提示一行都不打印 ⇒ 看起来像“跑了没用”）。
#    改成规范的收尾：落盘报告 + 打印提示。
$reportPath = Save-Report
Write-Host "报告已写入：$reportPath" -ForegroundColor DarkGray
Write-Host ''
if ($verified -and -not $RemoveSource) {
    Write-Host '下一步：验证模拟器能起来，然后加 -RemoveSource 重跑一次删掉 C 盘的源。' -ForegroundColor Yellow
    Write-Host '⚠ 但 -RemoveSource 走的是回收站 ⇒ **C 盘空间不会立刻释放**。' -ForegroundColor Yellow
    Write-Host '   必须再清空回收站才真正腾出来：scripts\clean-disk.ps1 -EmptyRecycleBin' -ForegroundColor Yellow
    Write-Host '   （清空回收站只有你自己能跑 —— AI 侧一律进回收站、不落真删）' -ForegroundColor DarkGray
}
