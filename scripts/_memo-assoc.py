#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #9 关联文件 + 更新 TASKS.md。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉘ #9 关联文件（让本应用出现在「打开方式」里）

用户口径：「在其他应用中打开本软件支持导入/打开的文件时，点以什么应用打开时 要能看到该软件」。

做法是给 `MainActivity` 加一组 `ACTION_VIEW` 的 `intent-filter`。**关键点是 MIME 的取舍**：

* `.hshp` / `.hsp` **没有注册的标准 MIME**（不像 `.mp3` 有 `audio/mpeg`），
  文件管理器多半把它归到 `application/octet-stream` ⇒ **必须带上这个兜底**，
  否则工程文件的「打开方式」里根本不会出现本应用；
* 同一 `<intent-filter>` 内 **同类型属性之间是 OR、不同类型之间是 AND**，
  所以 `content|file` × `{json, octet-stream, zip, audio/*, audio/midi}` 正是想要的语义。

✅ **实测验证**（`dumpsys package`）：应用已出现在 `audio/*`、`application/json`、
`application/octet-stream` 等类型的候选列表里：

```
audio/*:
  dc930ec com.arounder.hifisher/.MainActivity filter 271f4a
application/json:
  dc930ec com.arounder.hifisher/.MainActivity filter 271f4a
```

⚠️ **本轮只做了"能被看到"**；点「打开」之后**把 URI 送进导入流程**还没做
（需要 Kotlin 记 pending URI + Rust 暴露给前端 + 前端启动时取）。
⇒ 已记在 `TASKS.md` 的 #9 备注里。

已固化进 `scripts/setup-gen-android.sh` **§13**（`gen/` 下的 Manifest 会被 `tauri android init` 覆盖）。

### 🕳️ 顺带踩到的构建坑

改 Manifest 后**连续三次**构建失败，全是 `AccessDeniedException`，而且**每次锁的文件不同**：

1. `manifest_merge_blame_file/.../manifest-merger-blame-universal-debug-report.txt`
2. `merged_manifest/.../AndroidManifest.xml`

⇒ 不是 Manifest 语法问题，是 **`processUniversalDebugMainManifest` 这个 task 的输出文件被锁**
（本机安全层在扫描刚生成的文件）。**逐文件重试没用**，有效的是：
`gradlew --stop` 停 daemon + **把两处 intermediates 一起清掉** + 重建 ⇒ 一次通过。
**遇到这种"锁的文件每次都变"的情况，别逐个删，直接停 daemon 清一批。**
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉘ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 9 |")), None)
if line:
    new = ("| 9 | 关联文件：其他应用「打开方式」里能看到本软件 | ✅ **Manifest 部分完成并实测通过**："
           "给 MainActivity 加 ACTION_VIEW filter（`content|file` × `{json, octet-stream, zip, audio/*, audio/midi}`）。"
           "🔑 `.hshp` 无标准 MIME ⇒ **必须带 `application/octet-stream` 兜底**，否则工程文件不会出现在候选里。"
           "`dumpsys package` 实测已注册到 audio/* 与 application/json。"
           "已固化进 setup 脚本 §13。⏳ **点「打开」后送进导入流程未做**（需 Kotlin 记 pending URI + Rust 暴露 + 前端启动取）| A | WIP |")
    t = t.replace(line, new, 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md #9 已更新")
