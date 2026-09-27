#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# APK 体积审计：找出「本地文件头」与「中央目录」不一致造成的体积虚胖。
#
#   ./scripts/audit-apk.sh <某.apk>
#
# 为什么需要它（实测踩到的）：
#   probe 的 debug APK 实际 311 MB，但中央目录里 928 个条目的压缩合计只有 180 MB。
#   直接解析后发现：**本地文件头有 3021 个，中央目录只登记 928 个** ——
#   约 2093 个条目是「写了又被重写、旧数据留在文件里」的孤儿，
#   白白占了 ~131 MB（正好等于那个 .so 再存了一遍）。
#   debug 包无所谓，但**发布包必须查**：否则最终 APK 可能凭空翻倍。
# ══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

APK="${1:-}"
[ -z "$APK" ] && { echo "用法: $0 <apk 路径>"; exit 2; }
# ⚠️ 必须转成 **Windows 形式**（C:/...）再交给 python.exe：
# 本机实测，把 MSYS 路径（/c/...）传给原生 Windows 程序会直接失败
# （python 报 FileNotFoundError，curl 报 (23) write error，adb 则静默卡住）。
if [ "${APK:0:1}" != "/" ]; then APK="$(pwd)/$APK"; fi
if command -v cygpath >/dev/null 2>&1; then APK="$(cygpath -m "$APK")"; fi
[ -f "$APK" ] || { echo "❌ 找不到 $APK"; exit 1; }

PY="/c/Users/tzh/.workbuddy/binaries/python/versions/3.13.12/python.exe"
[ -x "$PY" ] || PY="python"

"$PY" - "$APK" <<'PY'
import struct, os, sys

p = sys.argv[1]
size = os.path.getsize(p)
data = open(p, "rb").read()

eocd = data.rfind(b"PK\x05\x06")
if eocd < 0:
    print("❌ 不是合法 zip/apk")
    sys.exit(1)
cd_entries = struct.unpack_from("<H", data, eocd + 10)[0]
cd_size, cd_off = struct.unpack_from("<II", data, eocd + 12)

# 遍历本地文件头
off, local_total, local_count = 0, 0, 0
per_name = {}          # 每个名字出现几次
per_name_bytes = []    # 每次出现的字节数，用于指出"是哪两份"
while off < cd_off:
    if data[off:off+4] != b"PK\x03\x04":
        off += 1
        continue
    (ver, flag, method, mt, md, crc, csize, usize, nlen, elen) = \
        struct.unpack_from("<HHHHHIIIHH", data, off + 4)
    name = data[off+30:off+30+nlen].decode("utf-8", "replace")
    hdr = 30 + nlen + elen
    local_total += hdr + csize
    local_count += 1
    per_name[name] = per_name.get(name, 0) + 1
    per_name_bytes.append((name, hdr + csize, usize))
    off += hdr + csize

print(f"文件            : {os.path.basename(p)}")
print(f"实际大小        : {size/1048576:9.1f} MB")
print(f"中央目录条目数  : {cd_entries}")
print(f"本地文件头条目数: {local_count}   ← 应当与中央目录一致")
orphan = local_count - cd_entries
print(f"孤儿/重复条目   : {orphan}")
print(f"本地占用合计    : {local_total/1048576:9.1f} MB")
print()

if orphan > 0:
    print(f"⚠️  存在孤儿条目 —— APK 体积虚胖（多出 {orphan} 条）。")

    # 精确指出哪些名字被写了多次，以及每次的**原始大小**。
    # 原始大小不同 ⇒ 是"上一版 + 这一版"（典型成因：AGP 增量打包复用上次输出，
    # 而 Rust 产出的 .so 每次构建都会变）。见 docs/02 §7.6。
    dup = {n: c for n, c in per_name.items() if c > 1}
    print(f"    被重复写入的名字：{len(dup)} 个")
    # 按"累计占用"从大到小
    dup_sorted = sorted(
        dup.items(),
        key=lambda kv: -sum(b for nn, b, _ in per_name_bytes if nn == kv[0]),
    )
    for n, c in dup_sorted[:6]:
        sizes = [u for nn, b, u in per_name_bytes if nn == n]
        total = sum(b for nn, b, u in per_name_bytes if nn == n)
        uniq = "（各次大小不同 → 新旧两份都在）" if len(set(sizes)) > 1 else "（各次大小相同）"
        print(f"      {n}")
        print(f"        出现 {c} 次，累计 {total/1048576:.1f} MB，"
              f"原始大小 {[f'{s/1048576:.1f}MB' for s in sizes]} {uniq}")

    if not dup:
        # 名字都不重复却有孤儿条目 → 是"写了但没进中央目录"的纯垃圾
        print("    （没有重名条目 → 是写入后未登记进中央目录的残留）")

    print("    → 典型成因：AGP 增量打包复用上次输出，而 Rust 的 .so 每次构建都会变。")
    print("      修法：构建前清 outputs/apk 与 intermediates 里的")
    print("      merged_native_libs/stripped_native_libs/merged_res/packaged_res")
    print("      （scripts/build-apk.sh 已默认做这件事）。")
    print("    → 另外检查 jniLibs 对齐/剥离设置、useLegacyPackaging、strip 任务。")
    sys.exit(2)
else:
    print("✅ 本地文件头与中央目录数量一致，无虚胖。")
PY
