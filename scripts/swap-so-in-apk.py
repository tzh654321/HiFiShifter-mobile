#!/usr/bin/env python3
"""把一个 APK 里指定的 `.so` 换成新的（其余条目原样搬运），供之后 zipalign + apksigner 重签。

为什么需要（2026-09-22）：`gradle :app:compressUniversalDebugAssets` 在本机对 arm64 变体
**稳定失败**（x86_64 能过），所以 arm64 的 APK 打不出来 —— 但 `cargo build` 是**成功**的，
arm64 的 `libbackend_lib.so` 就在 target 目录里。而本项目的前端（dist/）是**嵌进
`libbackend_lib.so`** 的（Tauri 2 Android 的 custom-protocol 模式），原生层代码没动的时候，
「旧 APK 外壳 + 新 libbackend_lib.so」与「重新完整构建」是**等价**的。

用法：
    python scripts/swap-so-in-apk.py <源 apk> <目标 apk> <apk内条目名> <新 so 路径> [更多对...]

例：
    python scripts/swap-so-in-apk.py \\
        dist/hifishifter-arm64-ui6.apk D:/hifishifter-out/_tmp.apk \\
        lib/arm64-v8a/libbackend_lib.so D:/hfshifter-target-upstream/aarch64-linux-android/debug/libbackend_lib.so

之后：
    zipalign -p -f 4 _tmp.apk _aligned.apk
    apksigner sign --ks ~/.android/debug.keystore ... _aligned.apk
"""
import sys
import zipfile
from pathlib import Path

# Android 11+ 默认 extractNativeLibs=false ⇒ APK 里的 .so 必须是 STORED（不压缩），
# 否则安装器会拒绝或运行时 dlopen 失败。zipalign 负责随后补 4 字节对齐。
NATIVE_EXT = ".so"


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 4 or len(args) % 2 != 0:
        print(__doc__)
        return 2

    src = Path(args[0])
    dst = Path(args[1])
    pairs = [(args[i], Path(args[i + 1])) for i in range(2, len(args), 2)]
    for _, so in pairs:
        if not so.is_file() or so.stat().st_size == 0:
            print(f"❌ 待替换的 .so 不存在或为空：{so}")
            return 1

    replaced = set()
    dst.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for item in zin.infolist():
            name = item.filename
            swap = next((p for p in pairs if p[0] == name), None)
            if swap:
                data = swap[1].read_bytes()
                replaced.add(name)
            else:
                data = zin.read(name)

            zi = zipfile.ZipInfo(name, date_time=item.date_time)
            zi.external_attr = item.external_attr
            zi.internal_attr = item.internal_attr
            zi.create_system = item.create_system
            # 原生库一律 STORED；其余条目沿用原 APK 的压缩方式。
            if name.endswith(NATIVE_EXT) or swap:
                zi.compress_type = zipfile.ZIP_STORED
            else:
                zi.compress_type = item.compress_type
            zout.writestr(zi, data)

    missing = [n for n, _ in pairs if n not in replaced]
    print(f"▸ 源   ：{src}（{src.stat().st_size / 1048576:.1f} MB）")
    print(f"▸ 目标 ：{dst}（{dst.stat().st_size / 1048576:.1f} MB）")
    for name, so in pairs:
        if name in replaced:
            print(f"  ✓ 已替换 {name}  ←  {so.stat().st_size / 1048576:.1f} MB")
    if missing:
        print("❌ 源 APK 里没有这些条目：" + ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
