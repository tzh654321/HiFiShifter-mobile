#!/usr/bin/env bash
# regen-frontend-patch.sh —— 把当前工作树里的**全部前端改动**折叠成 `0005-frontend-mobile-ui.patch`。
#
# 为什么必须用脚本（2026-09-20 的教训）：
#   上一轮是手敲命令，取文件列表用了 `git status --porcelain | awk '{print $2}'`。
#   对**未跟踪的目录**，porcelain 只给目录名（`?? frontend/src/components/mobile/`），
#   于是 `components/mobile/` 下 3 个新组件**从来没进过补丁** —— 而 `--include=<文件>`
#   的重放又能"通过"，因为比对时不会去找补丁里没有的文件。补丁就这么静默漂移了。
#   正确写法是 `git ls-files --others --exclude-standard`（逐文件枚举）。
#
# 实现要点：
#   · 全程只动 git 索引（独立 GIT_INDEX_FILE + update-index --cacheinfo），**零工作树写入**
#     —— 本环境会延迟丢弃批量写入（铺好 21 个文件只落地 14 个），不能靠临时目录。
#   · `hash-object --no-filters`：按**原始字节**入索引。本仓库已提交的 blob 与工作树
#     都是 CRLF（`.gitattributes` 虽写 eol=lf，但历史提交是 CRLF），用默认过滤器会把
#     工作树 blob 规范成 LF，导致「重放结果 vs 工作树」比对的字节数对不上。
#   · 生成后立刻跑 `verify-patches.sh` 才算完成。
#
# 用法：
#   bash scripts/regen-frontend-patch.sh          # 重新生成 0005
#   bash scripts/regen-frontend-patch.sh --check  # 只报会改动哪些文件，不写补丁
set -euo pipefail

CWD="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CWD"

SRC="$CWD/upstream-src"
SRC_W="$(cygpath -m "$SRC")"   # 原生 git 只认 Windows 形式路径（/c/... 会报 cannot change to）
OUT="$CWD/android/patches/0005-frontend-mobile-ui.patch"
WORK="$CWD/.patch-check"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

win() { cygpath -m "$1"; }

# ── ① 文件清单：改过的已跟踪文件 + 未跟踪文件（逐文件！）──────────────────────
mapfile -t FILES < <(
    {
        git -C "$SRC_W" diff --name-only -- frontend/
        git -C "$SRC_W" ls-files --others --exclude-standard -- frontend/
    } | sort -u
)
echo "▸ 目标文件 ${#FILES[@]} 个"

if [ "$CHECK_ONLY" = "1" ]; then
    printf '  %s\n' "${FILES[@]}"
    exit 0
fi

# ── ② 只动索引：把工作树的原始字节逐个入索引 ──────────────────────────────────
mkdir -p "$WORK"
export GIT_INDEX_FILE="$(win "$WORK/index-regen")"
/usr/bin/rm -f "$GIT_INDEX_FILE"
git -C "$SRC_W" read-tree HEAD

n=0
for rel in "${FILES[@]}"; do
    abs="$SRC/$rel"
    if [ ! -f "$abs" ]; then
        echo "  ⚠️ 跳过（不存在或不是文件）: $rel"
        continue
    fi
    blob=$(git -C "$SRC_W" hash-object -w -t blob --no-filters "$(win "$abs")")
    git -C "$SRC_W" update-index --add --cacheinfo "100644,$blob,$rel"
    n=$((n + 1))
done
echo "▸ 已入索引 $n / ${#FILES[@]} 个（不一致就是有文件被漏掉，别放过）"

# ── ③ 产出补丁 ──────────────────────────────────────────────────────────────
git -C "$SRC_W" diff --cached --binary -- frontend/ > "$OUT"

echo "▸ 已写出 $OUT （$(wc -l < "$OUT") 行）"
# 原生 git 只认 Windows 形式路径 —— 这里也要 cygpath，否则报
# "can't open patch '/c/...': No such file or directory"（文件明明在）
git apply --numstat "$(win "$OUT")"
echo
echo "下一步必做：bash scripts/verify-patches.sh"
