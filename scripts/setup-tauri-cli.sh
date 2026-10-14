#!/usr/bin/env bash
# 安装 tauri CLI 到仓库内的稳定位置 `.tools/tauri-cli/`。
#
# 为什么需要：构建链要一个 `tauri` 可执行文件（解析见 `scripts/tauri-cli-path.sh`），
# 而本项目**故意不用** `cargo install tauri-cli` —— 那要源码编译，慢一个量级。
# npm 的 `@tauri-apps/cli` 是**预编译**的原生 addon，装一次几秒。
#
# 用法：
#   bash scripts/setup-tauri-cli.sh            # 装 @tauri-apps/cli@2（与 Cargo.toml 的 tauri 2.x 对齐）
#   bash scripts/setup-tauri-cli.sh 2.11.4     # 指定版本
#
# 装到 `.tools/tauri-cli/`（在 .gitignore 内 —— 属于"下载的开发环境程序"，不入库）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/.tools/tauri-cli"
VER="${1:-2}"

NPM="npm"
if ! command -v "$NPM" >/dev/null 2>&1; then
    if command -v npm.cmd >/dev/null 2>&1; then
        NPM="npm.cmd"
    else
        echo "❌ 找不到 npm（先装 Node.js，或用其它方式把 tauri 放进 PATH）" >&2
        exit 1
    fi
fi

mkdir -p "$TARGET"
echo "▸ 安装 @tauri-apps/cli@$VER → $TARGET"
"$NPM" install --prefix "$TARGET" --no-audit --no-fund "@tauri-apps/cli@$VER"

# shellcheck source=scripts/tauri-cli-path.sh
. "$ROOT/scripts/tauri-cli-path.sh"
hfs_tauri_prepend_path
export PATH

if ! hfs_tauri_require; then
    echo "❌ 装完仍解析不到 tauri，请检查 $TARGET/node_modules/.bin" >&2
    exit 1
fi

printf '✅ 完成：%s\n' "$(tauri --version 2>/dev/null)"
echo "   位置：$HFS_TAURI_CLI_DIR"
