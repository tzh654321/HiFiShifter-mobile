#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#1 收尾：把图标脚本**固化进 setup**，修正文件名不匹配。

## 撞到的 bug

`setup-gen-android.sh` L103 调的是：

```
"$PYBIN" "$ROOT/scripts/gen-android-icons.py" <src> <res>
```

**但文件叫 `_gen-android-icons.py`（带下划线）** ⇒ 脚本根本不存在 ⇒
那句以 `|| echo "⚠ 图标生成失败（不影响构建，沿用默认图标）"` 兜底，
**失败是完全静默的** ⇒ 每次重放 setup 都"成功"，图标却从没被重生成。
（这解释了为什么 #1 一直卡在"尚未持久化"。）

另外 `_gen-adaptive-icon-xml.py`（自适应图标 XML + 颜色资源）**压根没被 setup 调用**。

## 修法

1. 去掉两个脚本名的下划线 —— 本项目的惯例是 `_` 前缀 = 一次性临时脚本，
   这两个是**要随 setup 重放的正式脚本**，名字该正过来；
2. setup 里两个都调（第一个**不吃参数**，原写法传了两个多余参数，一并去掉）。
"""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
S = ROOT / "scripts"

# ── ① 重命名（去掉下划线）────────────────────────────────────────────────
renames = [
    ("_gen-android-icons.py", "gen-android-icons.py"),
    ("_gen-adaptive-icon-xml.py", "gen-adaptive-icon-xml.py"),
]
for old, new in renames:
    src, dst = S / old, S / new
    if src.is_file():
        shutil.copy2(src, dst)          # 先复制，确认后再由用户决定旧的留不留
        print(f"✓ {old}  →  {new}")
    elif dst.is_file():
        print(f"· {new} 已存在")
    else:
        print(f"✗ 两个都没有：{old} / {new}")

# ── ② setup 脚本里改成正确调用 ───────────────────────────────────────────
SH = S / "setup-gen-android.sh"
t = SH.read_text(encoding="utf-8")

old_block = '''    "$PYBIN" "$ROOT/scripts/gen-android-icons.py" \\
      "$SRC/backend/src-tauri/icons/icon.png" \\
      "$(dirname "$GRADLE")/src/main/res" \\
      && echo "✓ 应用图标已生成为电脑版同款" || echo "⚠ 图标生成失败（不影响构建，沿用默认图标）"'''

new_block = '''    # ⚠️ 这两个脚本**不吃参数**（源图标/res 路径都硬编码在脚本里），
    # 之前这里多传了两个参数、文件名的下划线还对不上 ⇒ **静默失败**，重放时图标从没重生成。
    if "$PYBIN" "$ROOT/scripts/gen-android-icons.py" \\
       && "$PYBIN" "$ROOT/scripts/gen-adaptive-icon-xml.py"; then
      echo "✓ 应用图标已生成为电脑版同款（含自适应 + monochrome）"
    else
      echo "⚠ 图标生成失败（不影响构建，沿用默认图标）"
    fi'''

assert t.count(old_block) == 1, f"setup 锚命中 {t.count(old_block)} 次"
t = t.replace(old_block, new_block, 1)
SH.write_text(t, encoding="utf-8")
print("✓ setup-gen-android.sh 已修正（两个脚本都调、去掉多余参数）")
