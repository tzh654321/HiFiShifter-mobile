#!/usr/bin/env bash
# regen-patch.sh —— 按「补丁自己的文件清单」重新生成某个补丁。
#
#   bash scripts/regen-patch.sh 0003-android-platform-layer.patch
#   bash scripts/regen-patch.sh 0003-android-platform-layer.patch backend/src-tauri/src/platform/saf.rs
#
# 用途：改了补丁覆盖范围内的文件（或要往补丁里**加**新文件）之后，把工作树的最新内容
# 重新折成一个「base → 工作树」的整包增量。
#
# ⚠️ 文件清单取自**补丁自身**的 `diff --git` 行（外加命令行显式追加的文件）。
#    这是刻意的：上一轮 0005 就是因为手敲文件清单时用了
#    `git status --porcelain | awk '{print $2}'` —— 对**未跟踪目录**它只给目录名
#    （`?? frontend/src/components/mobile/`），于是 3 个新组件整整一轮没进补丁，
#    而 `verify-patches.sh` 照样"通过"（它只比对补丁里出现过的文件）。
#    用补丁自己的清单当基准，就不会漏掉已经进去了的文件。
#    ⇒ 含有**未跟踪新文件**的前端补丁（0005）走 `regen-frontend-patch.sh`，
#      它会用 `git ls-files --others` 逐文件枚举。
#
# 实现要点（都是踩过的坑）：
#   · 全程只动 git 索引（独立 GIT_INDEX_FILE + update-index --cacheinfo）—— 本环境会
#     延迟丢弃批量写入，不能靠临时目录铺文件。
#   · `hash-object --no-filters`：按**原始字节**入索引。本仓库已提交的 blob 与工作树都是
#     CRLF，用默认过滤器会把工作树 blob 规范成 LF，导致与工作树的字节比对对不上。
#   · 原生 git 只认 **Windows 形式**路径（`cygpath -m`），`/c/...` 会报
#     `cannot change to` / `can't open patch`。
#   · 生成后必须跑 `verify-patches.sh` 才算完成。
set -euo pipefail

CWD="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CWD"

SRC="$CWD/upstream-src"
SRC_W="$(cygpath -m "$SRC")"
WORK="$CWD/.patch-check"

win() { cygpath -m "$1"; }

PATCH_NAME="${1:-}"
if [ -z "$PATCH_NAME" ]; then
    echo "用法: $0 <patch 文件名> [额外文件...]" >&2
    echo "例:   $0 0003-android-platform-layer.patch backend/src-tauri/src/platform/saf.rs" >&2
    exit 2
fi
shift

PATCH="$CWD/android/patches/$PATCH_NAME"
if [ ! -f "$PATCH" ]; then
    echo "❌ 找不到 $PATCH" >&2
    exit 1
fi

# ── ① 文件清单 = 补丁现有清单 + 命令行追加 ────────────────────────────────────
mapfile -t FILES < <(
    {
        grep -h '^diff --git' "$PATCH" | sed 's|.* b/||'
        printf '%s\n' "$@"
    } | sed '/^$/d' | sort -u
)
echo "▸ $PATCH_NAME：目标文件 ${#FILES[@]} 个"

# ── ② 只动索引 ──────────────────────────────────────────────────────────────
mkdir -p "$WORK"
export GIT_INDEX_FILE="$(win "$WORK/index-regen")"
/usr/bin/rm -f "$GIT_INDEX_FILE"
git -C "$SRC_W" read-tree HEAD

n=0
skip=0
for rel in "${FILES[@]}"; do
    abs="$SRC/$rel"
    if [ ! -f "$abs" ]; then
        # 补丁里的新文件在 base 上当然不存在；但**工作树**里必须有，否则是漏了。
        echo "  ⚠️ 工作树里没有 $rel（若它是本补丁新建的文件，说明真源丢了）"
        skip=$((skip + 1))
        continue
    fi
    blob=$(git -C "$SRC_W" hash-object -w -t blob --no-filters "$(win "$abs")")
    git -C "$SRC_W" update-index --add --cacheinfo "100644,$blob,$rel"
    n=$((n + 1))
done
echo "▸ 已入索引 $n / ${#FILES[@]} 个（跳过 $skip）"

# ── ③ 产出补丁 ──────────────────────────────────────────────────────────────
git -C "$SRC_W" diff --cached --binary > "$PATCH"

echo "▸ 已写出 $PATCH （$(wc -l < "$PATCH") 行）"
git apply --numstat "$(win "$PATCH")"
echo
echo "下一步必做：bash scripts/verify-patches.sh"
