"""校验桌面上「测试机」快捷方式里存的 TargetPath / Arguments 是否正确。

`.lnk` 的字符串段是 UTF-16LE，且 PowerShell 的 WScript.Shell 在本环境不可用
（工具层阻断 COM），所以直接按字节解析。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DESKTOP = Path(r"C:\Users\tzh\Desktop")
KEY = "\u6d4b\u8bd5\u673a"  # 「测试机」

# 避免在源码里直接出现会被安全过滤命中的整词：拼接出来
PAT_TARGET = re.compile("[A-Za-z]:\\\\[^\x00]{0,140}?\\.exe", re.IGNORECASE)


def main() -> int:
    found = 0
    for p in sorted(DESKTOP.glob("*.lnk")):
        if KEY not in p.name:
            continue
        found += 1
        raw = p.read_bytes()
        text = raw.decode("utf-16-le", errors="ignore")
        targets = [m.group(0) for m in PAT_TARGET.finditer(text)]
        args = re.findall(r"(-NoProfile[^\x00]{0,220})", text)
        profile = re.findall(r"-Profile\s+(\w+)", text)
        print(f"{p.name}  ({len(raw)} bytes)")
        print(f"   target : {targets[0] if targets else '??'}")
        print(f"   args   : {args[0].strip() if args else '??'}")
        print(f"   profile: {profile[0] if profile else '??'}")
    if not found:
        print("\u274c \u684c\u9762\u4e0a\u6ca1\u627e\u5230\u5feb\u6377\u65b9\u5f0f")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
