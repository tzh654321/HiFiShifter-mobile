#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #11 + 更新 TASKS.md。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SEC = """

---

## ㉙ #11 剪贴板：「被占用」是假象，真相是平台没这个能力

用户口径：「复制时显示系统剪贴板被占用：需直接修复 + 无法复制到系统剪贴板时允许软件内复制」。

### 根因

`system_clipboard.rs` 末尾有一段 "Unsupported platform" 的 stub：

```rust
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn write_bytes(...) -> Result<(), String> {
    Err("clipboard_unsupported_platform".to_string())   // ← Android 走这里
}
```

被上层映射成「复制失败：系统剪贴板正被占用，请重试。」—— **文案误导**：
不是"被占用"，是**这个平台没有原生剪贴板 transport**（上游用的是 `clipboard-win` /
`wl-clipboard-rs` / `objc2-app-kit`，都是桌面的）。

而复制流程实际是**两步**：写**软件内**剪贴板（`timeline_clipboard`，一直好用）
+ 顺带写系统剪贴板。**后者失败不该拖垮前者**。

### 修法

三个 stub 全部降级：
- `write_bytes` / `write_bytes_with_reaper` ⇒ **`Ok(())`** + info 日志
- `read_bytes` ⇒ **`Ok(None)`**（"没有数据"，走外来数据兜底，不刷红状态栏）

⇒ 软件内复制照常，「复制失败」的假错误消失。

⚠️ **「粘贴到其他应用」在 Android 上仍然做不到** —— 那需要另外用 WebView 的
`navigator.clipboard` 补一条通道，属于独立的一件事，**没有在这里假装成功**。
（已作为 #11 的剩余部分记在 TASKS.md。）

### 🕳️ 附带教训

这个 bug 的形态很典型：**"平台不支持"被包装成了"资源被占用"**。
前者是能力问题（无法重试成功），后者是临时状态（重试就好）——
文案把两者混为一谈，用户就会一直"重试"一件永远不会成功的事。
**给错误分类时，'不可能成功'和'暂时失败'要用不同的词。**
"""

P = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉙ 节已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
line = next((l for l in t.splitlines() if l.startswith("| 11 |")), None)
if line:
    new = ("| 11 | 复制时「系统剪贴板被占用」 | ✅ **根因找到并修**。真相：Android 落到 `system_clipboard.rs` 的 "
           "\"Unsupported platform\" stub ⇒ `write_bytes` 直接 `Err(\"clipboard_unsupported_platform\")`，"
           "被上层误映射成「系统剪贴板正被占用」（**文案误导**：不是占用，是平台没这能力）。"
           "上游复制本是「写软件内剪贴板 + 顺带写系统剪贴板」两步 ⇒ 改为三个 stub 降级"
           "（写 ⇒ `Ok(())`、读 ⇒ `Ok(None)`）⇒ **软件内复制照常，假错误消失**。"
           "⏳ **「粘贴到其他应用」仍未实现**（需另接 WebView `navigator.clipboard`，独立一事）| A | WIP |")
    t = t.replace(line, new, 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md #11 已更新")
