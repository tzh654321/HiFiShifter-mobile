#!/usr/bin/env bash
# 把 android/patches/*.patch 按编号顺序重放到 upstream-src。
#
# 用法:
#   bash scripts/apply-patches.sh            # 应用全部
#   bash scripts/apply-patches.sh 0002       # 只应用编号前缀匹配的补丁
#
# 注意: 本仓库的 git checkout 分支切换会被中断, 见 docs/06 §4。
#       本脚本只用 `git apply`, 不做分支切换。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src"
PATCH_DIR="$ROOT/android/patches"
FILTER="${1:-}"

if [ ! -d "$SRC/.git" ]; then
    echo "错误: 找不到 $SRC/.git" >&2
    exit 1
fi

if [ ! -d "$PATCH_DIR" ] || [ -z "$(ls -A "$PATCH_DIR" 2>/dev/null)" ]; then
    echo "android/patches/ 为空, 没有补丁需要应用。"
    exit 0
fi

cd "$SRC"

# 原生 git 在 Windows 上不接受 MSYS 风格 /c/... 路径, 转成 C:/... (mixed) 风格。
# 非 Windows 环境没有 cygpath, 原样返回, 不影响可移植性。
cygpath_m() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

applied=0
for raw in "$PATCH_DIR"/*.patch; do
    [ -e "$raw" ] || continue
    name="$(basename "$raw")"
    patch="$(cygpath_m "$raw")"
    if [ -n "$FILTER" ] && [[ "$name" != "$FILTER"* ]]; then
        continue
    fi

    printf '==> %s ... ' "$name"

    # 已应用过就跳过（幂等）
    if git apply --reverse --check "$patch" >/dev/null 2>&1; then
        echo "已应用, 跳过"
        continue
    fi

    if ! git apply --check "$patch" >/dev/null 2>&1; then
        echo "失败"
        echo "   补丁无法干净应用。常见原因:" >&2
        echo "   1) 上游代码已变化 -> 需要更新补丁" >&2
        echo "   2) 与之前的补丁冲突 -> 检查补丁顺序" >&2
        echo "   手动排查: git apply -v --check \"$patch\"" >&2
        exit 1
    fi

    git apply "$patch"
    echo "OK"
    applied=$((applied + 1))
done

echo
echo "完成, 新应用 $applied 个补丁。"
echo "下一步: cd backend/src-tauri && cargo tauri android build -- --no-default-features --features onnx"
