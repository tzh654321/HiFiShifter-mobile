#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补两条通用教训进 skill（脚本改代码 / 引号转义）。"""
from pathlib import Path

S = Path(r"C:\Users\tzh\.workbuddy\skills\tauri2-android-bringup\SKILL.md")

ADD = """

### 5. 用脚本往已有代码里插语句：插完先看插入点上下文

用 Python/正则往大文件里插一个 `useEffect(...)` 时，**替换起始行是不够的 —— 收尾的 `)` 得自己对上**。
实测连续踩了两次：

1. 插到 `useCallback` 的依赖数组后面 ⇒ 把原有的 `);` 顶开 ⇒ `TS1005 ')' expected`；
2. 补了一个 `);`，结果和原本的重复 ⇒ `TS1128 Declaration or statement expected`；
3. 最后靠 `sed -n` 打出**插入点前后各 20 行**、肉眼比对，才定位到"多了一个"。

⇒ **规则：脚本插入代码块后，先 `sed -n '<插入点-20>,<插入点+20>p'` 看一眼**。
`tsc` 只会说"哪一行不对"，**不会说多了还是少了** —— 连续跑 tsc 猜是浪费时间。

### 6. 引号与反引号：一律 Write 成 `.py` 文件再跑，别用 `python -c`

`python -c "..."` 里的文本：
- **反引号**会被 bash 当**命令替换**执行（踩了 7 次，最惨一次把刚写的 memory 吞成残句）；
- **未转义的 `"`** 会直接让 Python 报 `unterminated triple-quoted string literal`（又踩 2 次）。

⇒ 只要要写的内容里含 **反引号 / `$` / `!` / 双引号**，就 **Write 成 `.py` 文件再执行**。
这条已经吃过太多次，属于"知道但没形成反射"的典型 —— 写进 skill 里当硬规矩。
"""

t = S.read_text(encoding="utf-8")
if "用脚本往已有代码里插语句" in t:
    print("· 已存在")
else:
    S.write_text(t.rstrip("\n") + ADD, encoding="utf-8")
    print("✓ skill 已追加两条通用教训")
print(f"  现在共 {len(S.read_text(encoding='utf-8').splitlines())} 行")
