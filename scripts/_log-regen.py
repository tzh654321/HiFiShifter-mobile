#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录补丁 regen 完成。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## ✅ 补丁 regen 完成（05:15-05:50）

本轮改了 9 个 upstream-src 文件，按项目硬规矩必须折进命名补丁。做了三步：

```
bash scripts/regen-patch.sh 0003-android-platform-layer.patch backend/src-tauri/src/system_clipboard.rs
bash scripts/regen-frontend-patch.sh
bash scripts/regen-patch.sh 0004-android-bundle-config.patch
bash scripts/verify-patches.sh
```

**关键点 —— 必须显式追加的文件**：
- **`system_clipboard.rs`**（#11 新增的 Android 剪贴板分支）**原本不在 0003 的清单里**
  ⇒ 必须作为「额外文件」追加，否则这一整块改动**不会进补丁**
  （`regen-patch.sh` 的文件清单取自补丁自身的 `diff --git` 行，新文件它不知道）。
- **`tauri.android.conf.json`**（#4 模型内置）在 0004 里只有 1 个 hunk，
  而工作树有更多改动 ⇒ 第一次 verify 报它**内容漂移**
  ⇒ regen 0004 后消失。

### 结果

```
✅ 自检通过：补丁可在干净基线上完整重放，且结果与工作树完全一致
   5 个补丁全 OK（0001..0005）· 比对 72 个文件 · 逐字节一致 · 缺失 0
```

⚠️ **教训**：`verify-patches.sh` 的价值就在这里 —— 它报的那条「内容漂移」
正是**补丁没跟上工作树**的信号。**每次改完 upstream-src 都要跑**，
而且**新文件要主动追加**（脚本不会替发现）。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ 补丁 regen 完成（2026-09-27 05:50）

本轮 9 个 upstream-src 改动已全部折进命名补丁：

```
regen-patch.sh 0003-... backend/src-tauri/src/system_clipboard.rs   # ⚠️ 新文件必须显式追加
regen-frontend-patch.sh                                            # 0005
regen-patch.sh 0004-...                                            # tauri.android.conf.json 漂移
```

✅ **`verify-patches.sh` 通过**：5 个补丁可在干净基线完整重放，
**72 个文件逐字节一致**、缺失 0。

⚠️ **两条经验**：
1. **新文件要主动追加** —— `regen-patch.sh` 的文件清单取自补丁自身的 `diff --git` 行，
   **它不知道新文件**（`system_clipboard.rs` 差点漏掉）；
2. 第一次 verify 报了 `tauri.android.conf.json` **内容漂移**（0004 里只有 1 个 hunk、
   工作树有更多改动）⇒ regen 0004 后消失。**这条报告正是「补丁没跟上工作树」的信号。**
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
