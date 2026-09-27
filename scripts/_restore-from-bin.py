#!/usr/bin/env python3
"""从 Windows 回收站里按「原路径关键字」找回文件 —— **复制**出来，不动回收站本身。

为什么需要它（2026-09-22）：本机 `rm` 一律进回收站且**不释放空间**，所以"删掉的东西"
常常还在盘上；而重新构建一次要 6 分钟 + C 盘本来就没空间。
这时直接把它捞回来比重建划算。

`$I<后缀>` 是元数据（原路径/大小/删除时间），`$R<后缀>` 是同一后缀的数据文件。

用法：
    python scripts/_restore-from-bin.py "app-universal-debug.apk" D:/hifishifter-out
    python scripts/_restore-from-bin.py "a.apk,b.apk" D:/out --index 1
"""
import shutil
import struct
import sys
from datetime import datetime, timedelta
from pathlib import Path

EPOCH = datetime(1601, 1, 1)


def parse_i(path: Path):
    """解析 $I 元数据（version 2 布局）。"""
    b = path.read_bytes()
    if len(b) < 28:
        return None
    size = struct.unpack_from("<q", b, 8)[0]
    ft = struct.unpack_from("<q", b, 16)[0]
    n = struct.unpack_from("<i", b, 24)[0]
    # ⚠️ 原路径按「字符数」给出且以 NUL 结尾 —— 必须 rstrip，否则拿到的字符串里带 \x00，
    # 后面 Path(...)/copy 会直接抛 `ValueError: embedded null character`。
    name = b[28 : 28 + n * 2].decode("utf-16-le", "replace").rstrip("\x00")
    return {
        "size": size,
        "when": EPOCH + timedelta(microseconds=ft / 10),
        "path": name,
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    keys = [k.strip() for k in args[0].split(",") if k.strip()]
    out = Path(args[1])
    index = 0
    if "--index" in sys.argv:
        index = int(sys.argv[sys.argv.index("--index") + 1])

    hits = []
    for drive in ("C:/$Recycle.Bin", "D:/$Recycle.Bin"):
        base = Path(drive)
        if not base.is_dir():
            continue
        for i_file in base.glob("*/$I*"):
            try:
                meta = parse_i(i_file)
            except Exception:
                continue
            if not meta:
                continue
            if not any(k.lower() in meta["path"].lower() for k in keys):
                continue
            r_file = i_file.with_name("$R" + i_file.name[2:])
            if r_file.is_file():
                hits.append((meta, r_file))

    if not hits:
        print(f"没有命中：{keys}")
        return 1

    hits.sort(key=lambda x: x[0]["when"], reverse=True)
    print(f"命中 {len(hits)} 条（新→旧）：")
    for n, (meta, r_file) in enumerate(hits[:8]):
        mark = "→" if n == index else " "
        print(
            f" {mark} [{n}] {meta['when']:%Y-%m-%d %H:%M}  "
            f"{meta['size'] / 1048576:9.1f} MB  {meta['path']}"
        )

    meta, r_file = hits[index]
    out.mkdir(parents=True, exist_ok=True)
    dst = out / Path(meta["path"]).name
    shutil.copy2(r_file, dst)
    print(f"\n已复制 → {dst}  ({dst.stat().st_size / 1048576:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
