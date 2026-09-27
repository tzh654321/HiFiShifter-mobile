#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 `docs/临时.xlsx` Sheet1 逐格打印（含 ✅ 标记），用于核对哪些格子已完成。"""
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "docs" / "临时.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

with zipfile.ZipFile(XLSX) as zf:
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    sheet = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))

for row in sheet.iter(f"{NS}row"):
    cells = []
    for c in row.findall(f"{NS}c"):
        ref = c.get("r")
        v = c.find(f"{NS}v")
        text = ""
        if v is not None and v.text is not None:
            text = shared[int(v.text)] if c.get("t") == "s" else v.text
        if text.strip():
            col = re.match(r"[A-Z]+", ref).group(0)
            cells.append(f"{col}={text.strip()}")
    if cells:
        print(f"[行 {row.get('r')}] " + " | ".join(cells))
