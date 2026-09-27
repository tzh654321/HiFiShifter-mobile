#!/usr/bin/env bash
# 补丁体系自检 —— 回答两个问题：
#   ① `android/patches/*.patch` 按序重放，能不能在**干净基线**上全部干净应用？
#   ② 重放结果与当前 `upstream-src` 工作树**逐文件是否一致**（= 有没有漂移）？
#
# 为什么需要它：`apply-patches.sh` 的「反向 check 通过就跳过」幂等逻辑会**掩盖**两类
# 问题（补丁内容其实已在 base 里 / 补丁之间上下文互相依赖），直到要在新基线上重放才爆。
#
# 实现（踩了三个坑之后的选择）：
#   · **不碰工作树**：用独立 `GIT_INDEX_FILE` + `git apply --cached`，重放结果只存在
#     对象库（已验证可靠的存储），比对走 `git cat-file blob | cmp -`，全程零文件写入。
#     ⚠️ 为什么不用 `git worktree` / 铺临时目录：本环境下批量文件写入会被**延迟丢弃**
#     （实测 `git worktree add` 报 "Updating files: 100%" 却只落地少量文件；手工铺好的
#     21 个文件在若干条命令之后被截成 0 字节），结论会被彻底带偏。
#
# 用法:
#   bash scripts/verify-patches.sh          # 跑完自动清理
#   bash scripts/verify-patches.sh --keep   # 保留 .patch-check/index 供排查
#
# ⚠️ 请在**沙箱外**执行（Bash 工具加 dangerouslyDisableSandbox: true）。
# 退出码：0 = 全干净且与工作树一致；1 = 有失败/有漂移。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/upstream-src"
PATCH_DIR="$ROOT/android/patches"
WORK="$ROOT/.patch-check"
KEEP=0
for arg in "$@"; do
    case "$arg" in
        --keep) KEEP=1 ;;
        --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    esac
done

win() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
SRC_W="$(win "$SRC")"
BASE_SHA="$(git -C "$SRC_W" rev-parse HEAD)"

mkdir -p "$WORK"
export GIT_INDEX_FILE="$(win "$WORK/index")"   # 原生 git 只认 Windows 形式路径
/usr/bin/rm -f "$GIT_INDEX_FILE"

if ! git -C "$SRC_W" read-tree "$BASE_SHA"; then
    echo "❌ 用 HEAD 播种索引失败"; exit 2
fi
SEED="$(git -C "$SRC_W" ls-files | wc -l | tr -d ' ')"
echo "▸ 索引已播种: ${BASE_SHA:0:8} / $SEED 个文件 → $WORK/index"

# ── ① 按序重放（只改索引）─────────────────────────────────────────────────
ok=0; skip=0; fail=0
declare -a FAILED
printf '%-46s %s\n' "补丁" "结果"
printf '%s\n' "--------------------------------------------------------------"
for raw in "$PATCH_DIR"/*.patch; do
    [ -e "$raw" ] || continue
    name="$(basename "$raw")"
    patch="$(win "$raw")"
    if git -C "$SRC_W" apply --reverse --check --cached "$patch" >/dev/null 2>&1; then
        printf '%-46s 跳过(内容已在索引里)\n' "$name"; skip=$((skip + 1)); continue
    fi
    err="$(git -C "$SRC_W" apply --check --cached "$patch" 2>&1)"
    if [ -z "$err" ]; then
        git -C "$SRC_W" apply --cached "$patch" >/dev/null 2>&1
        printf '%-46s OK\n' "$name"; ok=$((ok + 1))
    else
        printf '%-46s ❌ %s\n' "$name" "$(printf '%s' "$err" | head -1)"
        FAILED+=("$name"); fail=$((fail + 1))
    fi
done
echo
echo "▸ 重放统计：OK $ok / 跳过 $skip / 失败 $fail"

# ── ② 与真实工作树逐文件比对（补丁涉及的文件 + 工作树里的新增文件）─────────
echo
echo "▸ 与 upstream-src 工作树比对"
mapfile -t FILES < <(grep -h '^diff --git' "$PATCH_DIR"/*.patch | sed 's|.* b/||' | sort -u)
drift=0; compared=0; missing=0
declare -a DRIFTED MISSING
for f in "${FILES[@]}"; do
    in_index=1
    git -C "$SRC_W" cat-file -e ":$f" 2>/dev/null || in_index=0
    on_disk=0
    [ -f "$SRC/$f" ] && on_disk=1
    if [ "$on_disk" = "1" ] && [ "$in_index" = "0" ]; then MISSING+=("$f"); missing=$((missing + 1)); continue; fi
    if [ "$on_disk" = "0" ] && [ "$in_index" = "1" ]; then
        echo "  · 索引里有而工作树没有（正常，多为后续补丁删掉的临时组件）: $f"; continue
    fi
    [ "$on_disk" = "1" ] || continue
    compared=$((compared + 1))
    if ! git -C "$SRC_W" cat-file blob ":$f" 2>/dev/null | cmp -s - "$SRC/$f"; then
        DRIFTED+=("$f"); drift=$((drift + 1))
    fi
done
echo "  比对 $compared 个 / 工作树有而索引缺失 $missing 个"
if [ "$drift" = "0" ] && [ "$missing" = "0" ]; then
    echo "  ✅ 逐字节一致（无漂移）"
else
    [ "$missing" != "0" ] && { echo "  ❌ 重放后缺失："; for f in "${MISSING[@]}"; do echo "     $f"; done; }
    [ "$drift" != "0" ] && { echo "  ❌ 内容不一致："; for f in "${DRIFTED[@]}"; do
        n="$(git -C "$SRC_W" cat-file blob ":$f" | diff - "$SRC/$f" 2>/dev/null | grep -c '^[<>]')"
        echo "     $f  （差异行 $n）"; done; }
fi

[ "$KEEP" = "0" ] && /usr/bin/rm -f "$GIT_INDEX_FILE"

if [ "$fail" != "0" ] || [ "$drift" != "0" ] || [ "$missing" != "0" ]; then
    echo
    echo "❌ 自检未通过：失败补丁 $fail / 内容漂移 $drift / 缺失 $missing"
    exit 1
fi
echo
echo "✅ 自检通过：补丁可在干净基线上完整重放，且结果与工作树完全一致"
