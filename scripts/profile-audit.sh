#!/usr/bin/env bash
# profile-audit.sh —— 在一台模拟器上切换三套布局的视口并跑排版审计。
#
# 背景（2026-09-20）：本机的 `hs-tablet` / `hs-tablet2` AVD **都起不来**
# （qemu 启动即静默退出，无任何错误输出，连全新创建 + Nexus 10 普通平板配置也一样），
# 而 `hs-phone-tall` 稳定启动。因此平板视口用 `wm size` / `wm density` 在手机 AVD 上等价模拟：
#
#   phone    1080x2400 @480  →  CSS  360 x  800   dpr 3
#   tablet   1600x2560 @320  →  CSS  800 x 1280   dpr 2
#   desktop  2560x1600 @240  →  CSS 1706 x 1066   dpr 1.5
#
# 用法：
#   bash scripts/profile-audit.sh tablet                 # 切视口 + 审计
#   bash scripts/profile-audit.sh phone out.json         # 并存 JSON
#   bash scripts/profile-audit.sh reset                  # 还原物理分辨率
#
# 前置：应用已安装且在前台（脚本会 force-stop 后重启，保证 WebView 拿到新视口）。
set -u

SERIAL="${SERIAL:-emulator-5554}"
PKG=com.arounder.hifishifter
PORT="${PORT:-9222}"
PROFILE="${1:-phone}"
JSONARG="${2:-}"

adbq() { adb -s "$SERIAL" "$@" 2>&1; }

if [ "$PROFILE" = "reset" ]; then
    adbq shell wm size reset
    adbq shell wm density reset
    echo "已还原物理分辨率"
    exit 0
fi

case "$PROFILE" in
phone) SIZE=1080x2400; DPI=480 ;;
tablet) SIZE=1600x2560; DPI=320 ;;
desktop) SIZE=2560x1600; DPI=240 ;;
*)
    echo "用法: $0 <phone|tablet|desktop|reset> [out.json]" >&2
    exit 2
    ;;
esac

echo "▸ 切视口: $SIZE @${DPI}dpi"
adbq shell wm size "$SIZE" >/dev/null
adbq shell wm density "$DPI" >/dev/null
sleep 2

# 重启应用：WebView 在启动时读一次视口，density 变化必须重启才稳。
adbq shell am force-stop "$PKG" >/dev/null
sleep 1
adbq shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 16

PID=$(adbq shell pidof "$PKG" | tr -d '\r')
if [ -z "$PID" ]; then
    echo "❌ 应用没起来（pidof 为空）" >&2
    exit 1
fi
adb -s "$SERIAL" forward "tcp:$PORT" "localabstract:webview_devtools_remote_$PID" >/dev/null
sleep 1

CWD="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CWD" || exit 1
if [ -n "$JSONARG" ]; then
    node scripts/layout-audit.mjs --port "$PORT" --json "$JSONARG" --top 6
else
    node scripts/layout-audit.mjs --port "$PORT" --top 6
fi
