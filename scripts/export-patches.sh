#!/usr/bin/env bash
# 把 upstream-src 工作树里的改动反向导出成一个新补丁。
#
# 用法:
#   bash scripts/export-patches.sh 0002-android-model-path
#
# 会生成 android/patches/0002-android-model-path.patch
# 只导出已跟踪文件的改动（不含新增的未跟踪文件, 未跟踪文件请先 git add -N）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src"
PATCH_DIR="$ROOT/android/patches"
NAME="${1:-}"

if [ -z "$NAME" ]; then
    echo "用法: bash scripts/export-patches.sh <补丁名>  例: 0002-android-model-path" >&2
    exit 1
fi

cd "$SRC"

if [ -z "$(git status --porcelain)" ]; then
    echo "upstream-src 工作树没有改动, 无需导出。"
    exit 0
fi

mkdir -p "$PATCH_DIR"

# git status 里已经出现过的未跟踪文件, 也要纳入 diff
git add -N . 2>/dev/null || true

OUT="$PATCH_DIR/$NAME.patch"
git diff --binary > "$OUT"

lines="$(wc -l < "$OUT")"
echo "已导出: android/patches/$NAME.patch  ($lines 行)"
echo
echo "改动概览:"
git diff --stat | tail -20
echo
echo "提醒: 导出后建议在干净的上游版本上验证一次可重放性:"
echo "      bash scripts/apply-patches.sh"
