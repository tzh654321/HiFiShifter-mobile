#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TASKS.md 完整审计：把每条需求的状态分成三档。

- **DONE**   明确标了 ✅ / DONE / 已完成，且没有遗留的 ⏳/🟡/待… 尾巴；
- **PARTIAL** 有 ✅ 但仍带「待真机/待验证/待手测/未做/暂缓」等尾巴；
  或标了 🟡；
- **TODO**    没有完成标记（或只有 ⏳ / BLOCKED）。

按「表格行」为最小单位扫，输出三张清单。
"""
from pathlib import Path
import re

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
T = ROOT / "TASKS.md"
lines = T.read_text(encoding="utf-8").splitlines()

# 只看「需求行」：表格行且以 | 开头，且不是表头/分隔线
row_re = re.compile(r"^\|\s*(?P<id>[^|]{1,90}?)\s*\|\s*(?P<body>.+?)\s*\|\s*(?P<owner>[A-Z?][^|]*?)?\s*\|\s*(?P<status>[^|]*?)\s*\|\s*$")
simple_re = re.compile(r"^\|\s*(?P<id>[^|]{1,90}?)\s*\|\s*(?P<body>.+?)\s*\|\s*$")

DONE_PAT = re.compile(r"✅|DONE|已完成|已修|已核对")
OPEN_PAT = re.compile(r"⏳|🟡|待真机|待验证|待手测|待确认|待做|未做|暂缓|未接入|仍需|BLOCKED|TODO|WIP")
TAIL_PAT = re.compile(r"⏳[^|]*|🟡[^|]*")

done, partial, todo = [], [], []

for i, ln in enumerate(lines, 1):
    if not ln.startswith("|") or ln.startswith("| :") or ln.startswith("| # ") or ln.startswith("| :-"):
        continue
    m = row_re.match(ln) or simple_re.match(ln)
    if not m:
        continue
    ident = m.group("id").strip()
    body = m.group("body").strip()
    # 跳过纯表头
    if ident in ("#", "项", "条目", "需求", "交互（flm 表）", "位置", "层"):
        continue
    if len(body) < 4:
        continue

    blob = ln
    is_done = bool(DONE_PAT.search(blob))
    has_open = bool(OPEN_PAT.search(blob))

    # 摘出「未完成信号」的片段，便于人工判断
    snippets = []
    for mm in OPEN_PAT.finditer(blob):
        s = max(0, mm.start() - 18)
        snippets.append(blob[s : mm.end() + 30].replace("|", "/").strip())
    tail = " ｜ ".join(dict.fromkeys(snippets))[:150]

    if is_done and not has_open:
        done.append((i, ident, tail))
    elif is_done and has_open:
        partial.append((i, ident, tail))
    else:
        todo.append((i, ident, tail))

def show(title, items):
    print(f"\n{'=' * 72}\n{title}（{len(items)} 条）\n{'=' * 72}")
    for i, ident, tail in items:
        print(f"  L{i:<4} {ident[:70]}")
        if tail:
            print(f"         ↳ {tail}")

show("✅ 已完成（无尾巴）", done)
show("🟡 部分完成 / 待验证", partial)
show("⏳ 未做", todo)
print(f"\n合计：DONE {len(done)} / PARTIAL {len(partial)} / TODO {len(todo)}")
