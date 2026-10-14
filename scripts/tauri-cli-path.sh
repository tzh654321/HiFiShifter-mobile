#!/usr/bin/env bash
# 解析 tauri CLI（`@tauri-apps/cli`）的位置 —— 构建链的公共入口。
#
# 为什么需要它：本项目**故意不用** `cargo install tauri-cli`（要源码编译，慢得多），
# 而是用 npm 装的**预编译**二进制。原先固定放在 `probes/m0-probe/node_modules`，
# 而 `probes/` 已在 2026-10-05 的清理里删除 ⇒ 构建脚本 `command -v tauri` 直接失败
# （2026-10-14 修：改为按优先级解析 + 提供安装脚本）。
#
# 解析顺序（命中即止）：
#   ① 调用者 PATH 里已经有可用的 `tauri`        ← 尊重外部环境，本脚本不动 PATH
#   ② `$ROOT/.tools/tauri-cli/node_modules`     ← 本仓库的稳定位置（.gitignore 内）
#   ③ `$ROOT/probes/m0-probe/node_modules`      ← 旧探针路径（兼容，probes/ 已删）
#
# 用法：
#   source scripts/tauri-cli-path.sh     # 得到 $HFS_TAURI_CLI_DIR / _JS / _BIN，及下面两个函数
#   bash   scripts/tauri-cli-path.sh     # 打印 CLI 目录（拿不到则 exit 1）
#   bash   scripts/tauri-cli-path.sh --bin     # 打印 node_modules/.bin 目录
#   bash   scripts/tauri-cli-path.sh --check   # 只做检查：缺了就打印修复提示并 exit 1
#
# 缺 CLI 时怎么装 → `bash scripts/setup-tauri-cli.sh`

HFS_TAURI_NM=""
HFS_TAURI_CLI_DIR=""
HFS_TAURI_JS=""
HFS_TAURI_BIN=""

_hfs_tauri_resolve() {
    _hfs_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    HFS_TAURI_NM=""
    for _nm in \
        "$_hfs_root/.tools/tauri-cli/node_modules" \
        "$_hfs_root/probes/m0-probe/node_modules"; do
        if [ -f "$_nm/@tauri-apps/cli/tauri.js" ]; then
            HFS_TAURI_NM="$_nm"
            break
        fi
    done
    if [ -n "$HFS_TAURI_NM" ]; then
        HFS_TAURI_CLI_DIR="$HFS_TAURI_NM/@tauri-apps/cli"
        HFS_TAURI_JS="$HFS_TAURI_CLI_DIR/tauri.js"
        HFS_TAURI_BIN="$HFS_TAURI_NM/.bin"
    else
        HFS_TAURI_CLI_DIR=""
        HFS_TAURI_JS=""
        HFS_TAURI_BIN=""
    fi
    unset _hfs_root _nm
    return 0
}
_hfs_tauri_resolve

# 把仓库内的 CLI 加进 PATH（PATH 里已有 tauri 时**不动**，优先用调用者那份）。
# 用法：hfs_tauri_prepend_path; export PATH
hfs_tauri_prepend_path() {
    if command -v tauri >/dev/null 2>&1; then
        return 0
    fi
    if [ -n "$HFS_TAURI_BIN" ]; then
        PATH="$HFS_TAURI_BIN:$PATH"
    fi
    return 0
}

# 检查 CLI 是否可用；不可用则打印修复提示并返回 1。
hfs_tauri_require() {
    if command -v tauri >/dev/null 2>&1; then
        return 0
    fi
    cat >&2 <<'EOF'
❌ 找不到 tauri CLI（`@tauri-apps/cli`）。

   修法（任选其一）：
     ① 一条命令装好（推荐，需要网络，装到仓库内 `.tools/tauri-cli/`）：
          bash scripts/setup-tauri-cli.sh
     ② 自己装到同一位置：
          npm install --prefix .tools/tauri-cli @tauri-apps/cli@2
     ③ 让调用者的 PATH 里就有 `tauri`（例如全局 npm / 自备副本）

   注：**不要**用 `cargo install tauri-cli` —— 要源码编译，慢一个量级。
EOF
    return 1
}

# ── 直接运行（非 source）时的命令行接口 ──────────────────────────────────────
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    case "${1:-}" in
        --bin)
            [ -n "$HFS_TAURI_BIN" ] || { hfs_tauri_require; exit 1; }
            printf '%s\n' "$HFS_TAURI_BIN"
            ;;
        --check)
            hfs_tauri_prepend_path
            export PATH
            hfs_tauri_require || exit 1
            _v="$(tauri --version 2>/dev/null || echo '?')"
            printf '✅ %s\n' "$_v"
            ;;
        --help|-h)
            sed -n '2,20p' "$0"
            ;;
        *)
            [ -n "$HFS_TAURI_CLI_DIR" ] || { hfs_tauri_require; exit 1; }
            printf '%s\n' "$HFS_TAURI_CLI_DIR"
            ;;
    esac
fi
