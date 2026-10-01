#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修复 `~/.cargo/registry/src` 里被"磁盘写满"截成 0 字节的源码文件。

【为什么需要】2026-10-02 本机 C: 长期 96% 占用，某次写满把 cargo 缓存截了一批空文件。
最刺眼的一次表现是**构建失败在链接期**、报错完全指向别处：

    windows.0.52.0.lib : fatal error LNK1136: 无效或损坏的文件
    error: could not compile `HiFiShifter` (build script)

真实原因是 `~/.cargo/registry/src/<registry>/windows_x86_64_msvc-0.52.6/lib/windows.0.52.0.lib`
是 **0 字节**（应该 5.2 MB）。全盘扫下来这样的 0 字节文件有 **574 个**
（`brotli/src/enc/*.rs`、`encoding_rs/src/data.rs`、`webview2-com-sys/*.lib` … 都在内）。

【怎么修】**从同目录的 `.crate` 归档里重新解出来** —— 不用联网、不用重下。
   · `~/.cargo/registry/cache/<registry>/<crate>-<ver>.crate` 是 **gzip 过的 tar**
     （别用 zipfile！`037 213` 是 gzip 魔数，用 zipfile 会误报 "File is not a zip file"）。
   · `src/<registry>/<crate>-<ver>/` 与 cache 里的 `<crate>-<ver>.crate` 一一对应。

⚠️ 有些文件在 crate 里**本来就是 0 字节**（`.nojekyll`、部分 license 占位），重解无损。

用法：
    python scripts/fix-cargo-zero-byte.py            # 只报告
    python scripts/fix-cargo-zero-byte.py --apply    # 真修
"""

import argparse
import gzip
import os
import sys
import tarfile

CARGO = os.path.expanduser("~/.cargo/registry")


def repair(apply: bool) -> int:
    src_root = os.path.join(CARGO, "src")
    cache_root = os.path.join(CARGO, "cache")
    if not os.path.isdir(src_root):
        print("找不到 " + src_root)
        return 1

    total_zero = 0
    fixed = 0
    missing_archive = []
    broken_archive = []
    no_member = []

    for registry in sorted(os.listdir(src_root)):
        reg_src = os.path.join(src_root, registry)
        reg_cache = os.path.join(cache_root, registry)
        if not os.path.isdir(reg_src):
            continue
        for crate in sorted(os.listdir(reg_src)):
            crate_dir = os.path.join(reg_src, crate)
            if not os.path.isdir(crate_dir):
                continue
            zeros = []
            for root, _dirs, files in os.walk(crate_dir):
                for f in files:
                    p = os.path.join(root, f)
                    try:
                        if os.path.getsize(p) == 0:
                            zeros.append(p)
                    except OSError:
                        pass
            if not zeros:
                continue
            total_zero += len(zeros)
            archive = os.path.join(reg_cache, crate + ".crate")
            if not os.path.isfile(archive) or os.path.getsize(archive) == 0:
                missing_archive.append(crate)
                continue
            try:
                with gzip.open(archive, "rb") as fh:
                    tf = tarfile.open(fileobj=fh, mode="r:")
                    names = {m.name: m for m in tf.getmembers() if m.isfile()}
                    for z in zeros:
                        rel = os.path.relpath(z, crate_dir).replace("\\", "/")
                        member = names.get(crate + "/" + rel)
                        if member is None:
                            no_member.append(z)
                            continue
                        size = member.size
                        if size == 0:
                            continue  # crate 里本来就是空文件
                        print(("修 " if apply else "待修 ") + z + "  (0 -> %d)" % size)
                        if apply:
                            data = tf.extractfile(member).read()
                            with open(z, "wb") as out:
                                out.write(data)
                        fixed += 1
            except (tarfile.TarError, OSError, EOFError) as exc:
                # 归档本身也坏了（同样是被写满截的）⇒ 只能联网 cargo fetch 重下
                broken_archive.append("%s (%s)" % (crate, exc.__class__.__name__))
                continue

    print("")
    print("0 字节文件总数：%d" % total_zero)
    print("可从 .crate 复原：%d" % fixed)
    if missing_archive:
        print("缺 .crate 归档的 crate（需联网 cargo fetch）：%s" % ", ".join(missing_archive[:10]))
    if no_member:
        print("归档里找不到对应成员（多半是 cargo 自己生成的）：%d 个" % len(no_member))
    if not apply and fixed:
        print("")
        print("加 --apply 真修。")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    sys.exit(repair(ap.parse_args().apply))
