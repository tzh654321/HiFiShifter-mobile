#!/usr/bin/env python3
"""解析 Windows 回收站的 $I 元数据文件，回答"到底是谁在往回收站丢东西"。

$I 文件格式（Vista 及以后，version 2）：
  偏移 0   8 字节  头部（版本号，一般 0x02）
  偏移 8   8 字节  原文件大小
  偏移 16  8 字节  删除时间（FILETIME，UTC）
  偏移 24  4 字节  原路径长度（**字符数**，不含结尾 NUL）
  偏移 28  …       原路径（UTF-16LE，以 NUL 结尾）

用法：python scripts/_binreport.py [盘符...] [--top N] [--recent N]
      python scripts/_binreport.py D: --recent 25
"""
import struct
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

EPOCH = datetime(1601, 1, 1)


def parse_i(path: Path):
    try:
        b = path.read_bytes()
    except OSError:
        return None
    if len(b) < 28:
        return None
    size = struct.unpack_from("<Q", b, 8)[0]
    ft = struct.unpack_from("<Q", b, 16)[0]
    n = struct.unpack_from("<I", b, 24)[0]
    raw = b[28:28 + n * 2]
    if not raw:
        return None
    try:
        name = raw.decode("utf-16-le", errors="replace").rstrip("\x00")
    except Exception:
        return None
    if not name:
        return None
    try:
        when = EPOCH + timedelta(microseconds=ft / 10)
    except Exception:
        when = None
    return name, size, when


def scan(drive: str):
    root = Path(drive + "\\$Recycle.Bin")
    if not root.is_dir():
        return []
    out = []
    for sid_dir in root.iterdir():
        if not sid_dir.is_dir():
            continue
        for f in sid_dir.glob("$I*"):
            r = parse_i(f)
            if r:
                out.append(r)
    return out


def main():
    args = [a for a in sys.argv[1:]]
    top = 12
    recent = 20
    drives = []
    i = 0
    while i < len(args):
        if args[i] == "--top":
            top = int(args[i + 1]); i += 2
        elif args[i] == "--recent":
            recent = int(args[i + 1]); i += 2
        else:
            drives.append(args[i]); i += 1
    if not drives:
        drives = ["C:", "D:"]

    rows = []
    for d in drives:
        rows += scan(d)

    total = sum(r[1] for r in rows)
    print(f"回收站条目 {len(rows)} 个，合计 {total/1048576:.1f} MB\n")

    # ── 按「原路径的父目录」聚合，看谁在批量丢 ──
    def parent(p: str) -> str:
        try:
            return str(Path(p).parent)
        except Exception:
            return p

    c = Counter()
    s = Counter()
    for name, size, _ in rows:
        p = parent(name)
        c[p] += 1
        s[p] += size
    print(f"── 条目最多的来源目录（前 {top}）──")
    for p, n in c.most_common(top):
        print(f"  {n:6} 个  {s[p]/1048576:9.1f} MB  {p}")

    print(f"\n── 最近被丢进来的 {recent} 条 ──")
    dated = [r for r in rows if r[2]]
    dated.sort(key=lambda r: r[2], reverse=True)
    for name, size, when in dated[:recent]:
        print(f"  {when:%m-%d %H:%M:%S}  {size/1024:8.1f} KB  {name}")

    # ── 顶层目录（家目录 / 盘根）粒度 ──
    print("\n── 按「盘 + 一级目录」汇总 ──")
    c2 = Counter()
    s2 = Counter()
    for name, size, _ in rows:
        parts = Path(name).parts
        key = "\\".join(parts[:2]) if len(parts) >= 2 else name
        c2[key] += 1
        s2[key] += size
    for k, n in c2.most_common(top):
        print(f"  {n:6} 个  {s2[k]/1048576:9.1f} MB  {k}")


if __name__ == "__main__":
    main()
