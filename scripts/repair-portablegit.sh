#!/usr/bin/env bash
# 修复 WorkBuddy 托管 PortableGit —— 29 个文件在 2026-09-27 20:42 被截成 0 字节
# （同时刻 C 盘写满；同一次事件只影响这 29 个文件，之后无新增）
#
# 供体：本机已装的 VS 2022 Team Explorer 自带 Git for Windows 2.55.0.windows.5
#       （目标包是 2.55.0.windows.3，同版只差补丁号 ⇒ DLL 兼容）
# 只写、不删；每写一个立刻 cmp 校验。
set -uo pipefail

VS="/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/TeamFoundation/Team Explorer/Git"
GH="/c/Users/tzh/AppData/Local/GitHubDesktop/app-3.5.8/resources/app/git"
PG="/c/Users/tzh/.workbuddy/binaries/PortableGit/versions/1.2.0"

FILES="
mingw64/bin/Avalonia.Base.dll
mingw64/bin/av_libglesv2.dll
mingw64/bin/git-http-fetch.exe
mingw64/bin/git-http-push.exe
mingw64/bin/git-remote-http.exe
mingw64/bin/git-remote-https.exe
mingw64/bin/git-sh-i18n--envsubst.exe
mingw64/bin/git.exe
mingw64/bin/libcrypto-3-x64.dll
mingw64/bin/libHarfBuzzSharp.dll
mingw64/bin/libiconv-2.dll
mingw64/bin/libSkiaSharp.dll
mingw64/bin/libunistring-5.dll
mingw64/bin/libzstd.dll
mingw64/bin/Microsoft.Identity.Client.dll
mingw64/bin/scalar.exe
usr/bin/awk.exe
usr/bin/sh.exe
usr/bin/msys-crypto-3.dll
usr/bin/msys-sqlite3-0.dll
"

ok=0; fail=0; skip=0
printf '%-42s %-10s %s\n' "文件" "结果" "字节"
printf '%s\n' "---------------------------------------------------------------"
for rel in $FILES; do
    src="$VS/$rel"; [ -f "$src" ] || src="$GH/$rel"
    dst="$PG/$rel"
    if [ ! -f "$src" ]; then
        printf '%-42s %-10s %s\n' "$rel" "无供体" "-"; skip=$((skip+1)); continue
    fi
    cp -f "$src" "$dst" 2>/dev/null
    if cmp -s "$src" "$dst"; then
        printf '%-42s %-10s %s\n' "$rel" "OK" "$(stat -c%s "$dst")"; ok=$((ok+1))
    else
        printf '%-42s %-10s %s\n' "$rel" "❌校验失败" "$(stat -c%s "$dst" 2>/dev/null)"; fail=$((fail+1))
    fi
done

# gawk 两个名字在 WorkBuddy 包里是 awk.exe 的副本（VS 包里没有独立文件）
for name in gawk.exe gawk-5.4.0.exe; do
    src="$VS/usr/bin/awk.exe"; dst="$PG/usr/bin/$name"
    cp -f "$src" "$dst" 2>/dev/null
    if cmp -s "$src" "$dst"; then
        printf '%-42s %-10s %s\n' "usr/bin/$name" "OK(由 awk 复制)" "$(stat -c%s "$dst")"; ok=$((ok+1))
    else
        printf '%-42s %-10s %s\n' "usr/bin/$name" "❌校验失败" "-"; fail=$((fail+1))
    fi
done

# GH 独有的 msys-zstd
rel="usr/bin/msys-zstd-1.dll"
if [ -f "$GH/$rel" ]; then
    cp -f "$GH/$rel" "$PG/$rel" && cmp -s "$GH/$rel" "$PG/$rel" \
      && { printf '%-42s %-10s %s\n' "$rel" "OK(GH)" "$(stat -c%s "$PG/$rel")"; ok=$((ok+1)); } \
      || { printf '%-42s %-10s %s\n' "$rel" "❌校验失败" "-"; fail=$((fail+1)); }
fi

echo
echo "成功 $ok / 失败 $fail / 跳过 $skip"
echo
echo "▸ 复查：整个 PortableGit 树里还剩几个 0 字节文件"
find "$PG" -size 0 -type f | sed "s|$PG/||"
