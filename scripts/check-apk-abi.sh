#!/usr/bin/env bash
# check-apk-abi.sh —— 装机前自检：**这个包能不能装到那台设备上**。
#
# 为什么需要它（2026-09-27 踩的坑）：
#   `build-apk.sh <abi>` 每次都用**同一个输出路径**
#       gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
#   ⇒ 构建过 arm64 之后，那个文件**就是 arm64-only 包**。
#     再把它装进 x86_64 模拟器 ⇒ 只能靠 **ARM 转译**跑
#     ⇒ **onnxruntime 的 JIT 代码在转译下崩**（SIGSEGV @ 0x8，tid=ort-prewarm-*）。
#     症状极具误导性：崩前日志一切正常（ndk_context/模型就绪全打印了），
#     看起来就像"代码把 ONNX 初始化改坏了"。
#
# 所以：**装机前先比对两个 ABI**。
#
# 用法：
#   bash scripts/check-apk-abi.sh <apk 路径> [设备序列号]
#   bash scripts/check-apk-abi.sh D:/hifishifter-out/hifishifter-arm64-v8a-debug.apk 221deeb
#   bash scripts/check-apk-abi.sh --device 221deeb          # 只报设备 ABI 与推荐包
#
# 退出码：0 = 匹配（或未给设备）；1 = **不匹配**（装上去必崩）；2 = 用法/环境错误
set -euo pipefail

CWD="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB:-D:/Android/Sdk/platform-tools/adb.exe}"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

# ── 模式二：只问设备 ─────────────────────────────────────────────────
if [ "${1:-}" = "--device" ]; then
    DEV="${2:?用法: $0 --device <serial>}"
    # ⚠️ `|| true` 不能省：`set -e` 下，命令替换里的 adb 一旦非零退出，
    # 整个脚本会在**赋值那一行**就静默死掉（exit 1、无任何输出），
    # 下面的"设备不可达"提示永远打不出来。踩过。
    ABI="$("$ADB" -s "$DEV" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n' || true)"
    ABI2="$("$ADB" -s "$DEV" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r\n' || true)"
    if [ -z "$ABI" ]; then red "❌ 设备 $DEV 不可达（或未授权）"; exit 2; fi
    echo "设备 $DEV"
    echo "  主 ABI   : $ABI"
    echo "  支持 ABI : $ABI2"
    case "$ABI" in
        arm64-v8a) echo "  ⇒ 用 D:/hifishifter-out/hifishifter-arm64-v8a-debug.apk" ;;
        x86_64)    echo "  ⇒ 用 D:/hifishifter-out/hifishifter-x86_64-debug.apk"  ;;
        *)         ylw "  ⚠️ 未预置该 ABI 的归档名，请自行确认" ;;
    esac
    exit 0
fi

APK="${1:-}"
if [ -z "$APK" ]; then echo "用法: $0 <apk> [serial] | $0 --device <serial>" >&2; exit 2; fi
[ -f "$APK" ] || { red "❌ 找不到 APK: $APK"; exit 2; }

# ── 读 APK 里真的装了哪些 ABI ────────────────────────────────────────
# 用 python 读 ZIP 中央目录（`unzip -l` 在有些环境没有）。
PY="${PY:-C:/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe}"
command -v "$PY" >/dev/null 2>&1 || PY=python

APK_ABIS="$("$PY" - "$APK" <<'PYEOF'
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
abis = set()
for n in z.namelist():
    m = re.match(r'^lib/([^/]+)/', n)
    if m:
        abis.add(m.group(1))
print(','.join(sorted(abis)))
PYEOF
)"

echo "APK: $(basename "$APK")"
echo "  含 ABI   : ${APK_ABIS:-（无 lib/ 条目）}"

DEV="${2:-}"
if [ -z "$DEV" ]; then
    ylw "  ⚠️ 未给设备序列号 ⇒ 只报了包的 ABI，未做匹配检查"
    exit 0
fi

DEV_ABI="$("$ADB" -s "$DEV" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r\n' || true)"
if [ -z "$DEV_ABI" ]; then red "❌ 设备 $DEV 不可达（或未授权）"; exit 2; fi
echo "设备 $DEV"
echo "  主 ABI   : $DEV_ABI"

# ── 判定 ─────────────────────────────────────────────────────────────
if [ -z "$APK_ABIS" ]; then
    red "❌ 包内没有任何 lib/<abi>/ 条目 —— 这个包不可能跑起来 native 代码"
    exit 1
fi

case ",$APK_ABIS," in
    *",$DEV_ABI,"*)
        grn "✅ 匹配：包内含 $DEV_ABI，设备主 ABI 也是 $DEV_ABI —— 可以装"
        exit 0
        ;;
esac

red "❌ **不匹配**：包内只有 [$APK_ABIS]，而设备主 ABI 是 $DEV_ABI"
echo
echo "  说明：设备会走 ABI 转译（如 arm64 包跑在 x86_64 模拟器上）"
echo "        ⇒ onnxruntime 等 JIT 代码**极可能 SIGSEGV**，"
echo "          且崩前日志一切正常，极具迷惑性（见本脚本头部注释）。"
echo "  处置：构建（或改用归档里）与设备 ABI 匹配的包："
case "$DEV_ABI" in
    arm64-v8a) echo "        bash scripts/build-apk.sh arm64-v8a   # ⇒ hifishifter-arm64-v8a-debug.apk" ;;
    x86_64)    echo "        bash scripts/build-apk.sh x86_64      # ⇒ hifishifter-x86_64-debug.apk" ;;
    *)         echo "        bash scripts/build-apk.sh $DEV_ABI" ;;
esac
echo
echo "  ⚠️ 别直接用 gen/android/.../app-universal-debug.apk ——"
echo "     那个路径是**共用的**，它的 ABI 取决于**最后一次构建**。"
exit 1
