#!/usr/bin/env bash
# build-progress.sh —— 一眼看 APK 构建进度（日志尾 / 进程 / 归档与失败标记 / 产物时间）。
#
# 为什么单独做一个：`bash scripts/build-apk.sh` 输出很长且是**增量**的，
# 光看 `tail` 分不清"在编依赖 / 在编主 crate / 在打包 / 已经失败"。
# 这个脚本把四个判据一次打出来：
#   ① 日志尾 + 行数（在长就说明还在动）
#   ② `cargo / rustc / java` 进程数（0 = 已停手）
#   ③ 日志里有没有 **归档** / **失败** 标记
#   ④ 产物 APK 的 mtime（比日志新 ⇒ 已出包）
#
# 用法：
#   bash scripts/build-progress.sh                 # 自动取 D:/Temp/build-*.out 里最新的那份
#   bash scripts/build-progress.sh /d/Temp/xxx.out # 指定日志
#   watch -n 20 bash scripts/build-progress.sh     # 盯着看（Git Bash 有 watch 就用）
#
# ⚠️ 本脚本**只读**：不杀进程、不删文件、不碰工作树。

LOG="${1:-}"
if [ -z "$LOG" ]; then
    # 取 D:/Temp 下最新的 build-*.out
    LOG="$(ls -1t /d/Temp/build-*.out 2>/dev/null | head -1)"
fi

if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
    echo "❌ 找不到构建日志"
    echo "   给个路径：bash scripts/build-progress.sh /d/Temp/build-xxx.out"
    echo "   或自己起一次：bash scripts/build-apk.sh arm64-v8a > /d/Temp/build-$(date +%H%M).out 2>&1 &"
    exit 1
fi

echo "── 构建进度 ── $(date '+%m-%d %H:%M:%S')"
echo "日志     : $LOG"
echo "日志时间 : $(ls -la --time-style=+%H:%M:%S "$LOG" | awk '{print $6}')   行数: $(wc -l < "$LOG")"

# 在编的进程（0 = 已经停手，要么完成要么失败）
NPROC="$(ps -W 2>/dev/null | grep -icE 'cargo|rustc|java')"
if [ "$NPROC" -gt 0 ]; then
    echo "进程     : $NPROC 个（cargo/rustc/java）⇒ **仍在构建**"
else
    echo "进程     : 0 ⇒ **已停手**（看下面的归档/失败标记）"
fi

# 归档 / 失败标记
if grep -qaE '已归档' "$LOG"; then
    echo "结果     : ✅ 已归档（打包完成）"
fi
if grep -qaE 'BUILD FAILED|Error failed to build|failed to build Android app' "$LOG"; then
    echo "结果     : ❌ 构建失败 —— 最后 12 行："
    tail -12 "$LOG" | sed 's/^/           /'
fi
if grep -qaE '拒绝访问|os error 5' "$LOG"; then
    echo "提示     : 命中「拒绝访问 (os error 5)」⇒ 见 docs/17 §「构建前必须清掉 gradle 守护进程」/ §跨 profile 产物权限"
fi

echo "日志尾   :"
tail -3 "$LOG" | sed 's/^/           /'

# 产物
echo "产物 APK :"
for f in /d/code/HiFiShifter/hifishifter-out/hifishifter-arm64-v8a-debug.apk /d/code/HiFiShifter/hifishifter-out/hifishifter-x86_64-debug.apk; do
    if [ -f "$f" ]; then
        echo "           $(basename "$f")  $(ls -la --time-style=+%m-%d_%H:%M "$f" | awk '{print $6}')  $(du -h "$f" | cut -f1)"
    fi
done
echo "           设备上装的：adb shell dumpsys package com.arounder.hifishifter | grep lastUpdateTime"
