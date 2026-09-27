#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重写 memory 日志的 ㉒ 节。

原因：上一版是用 `python -c "..."` 传的，正文里的反引号被 **bash 当成命令替换**执行，
反引号包裹的内容全被吞掉（日志里出现「### 根因：**ColorOS 在用户正常选完时也回 **」这种残句）。
写成 .py 文件就不会经过 bash 解析。
"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"
MARK = "## ㉒ 保存：ROM 返回码误判"

SEC = """## ㉒ 保存：ROM 返回码误判 + 「记住上次位置」

**用户反馈**：保存能弹出原生文件管理了 ✓，但点保存仍报「已取消保存」、只留下一个 **0 B 文件**；
并明确需求「一个工程只有初次保存需要打开文件管理，所有软件都是这么设计的」。

### 根因：**ColorOS 在用户正常选完时也回 `RESULT_CANCELED`**

日志里只剩我们那句「→ 用户取消」（说明 Kotlin 回了 `saf_cancelled`），据此逐层拆：
`dialog.save_file` → `saf.request(KIND_SAVE)` → Kotlin `onActivityResult` —— 卡在原判定：

```kotlin
if (resultCode != Activity.RESULT_OK) { nativeOnResult(..., "saf_cancelled"); return }
```

**部分 ROM 在 data 里明明带回了 URI 的情况下仍回 `RESULT_CANCELED`** ⇒ 正常保存被当成取消。
（那个 0 B 文件是系统按用户选择**预先创建**的占位；我们没上传，所以它一直是空的 ——
这恰好也是「有 URI」的旁证。）

**修法：判定顺序反过来 —— 先看有没有 URI，没 URI 才算取消**，`resultCode` 只留日志。
语义上本来也该如此：**有 URI = 用户选定了**，`data` 为空才是真取消。
⚠️ 这类「先信文档字段、不信实际数据」的取舍在厂商 ROM 上是必需的 ——
**数据比状态码可信**。

### 新需求：「记住上次保存位置」

- `buildIntent` 的 `KIND_SAVE` 补 `FLAG_GRANT_WRITE_URI_PERMISSION` +
  `FLAG_GRANT_PERSISTABLE_URI_PERMISSION`（跨会话写权限的前提）；
- 拿到 URI 后 `takePersistableUriPermission` + 存进 `SharedPreferences(hs_saf_save_targets)`；
- **key = `mime:<mime>|ext:<ext>`** ⇒ 「导出音频 / 导出 MIDI / 工程保存」各自记各的位置，
  互不干扰（`audio/*`、`audio/midi`、`*/*` 天然区分开）；
- `request()` 里**保存方向先查已存位置**：命中就直接 `nativeOnResult`，**不再弹框** ✓
  （首次才弹 —— 正是用户说的"所有软件都这么设计"）。

**换位置**的入口仍然存在（上游的「另存为…」），所以记住位置不会把用户锁死。

🕳️ **反引号坑今天踩了第四次**：`python -c "…"` 含反引号时会被 **bash 当命令替换**执行 ——
这次直接把刚写好的日志吞成了残句（上一版就是这样坏的）。
⇒ **批量写文档/代码一律写成 `.py` 文件再跑**，不要用 `-c` 传长文本。
（同类坑在 §⑪ 的 Kotlin KDoc、§㉑ 的 `_impl-save-file.py` 已经各踩过一次。）
"""

text = P.read_text(encoding="utf-8")
idx = text.find(MARK)
if idx < 0:
    print("✗ 找不到 ㉒ 节标记")
    raise SystemExit(1)
P.write_text(text[:idx] + SEC, encoding="utf-8")
print("✓ ㉒ 节已重写（带完整反引号内容）")
