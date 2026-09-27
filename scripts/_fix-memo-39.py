#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补回 ㊴ 节被 bash 吞掉的反引号内容（用文件方式写，避免再踩）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"
t = P.read_text(encoding="utf-8")

start = t.index("## ㊴ 真机（221deeb）状态")
fixed = """## ㊴ 真机（221deeb）状态：#4 已验证、#7 等日志

装机（arm64，286 MB）后确认：

- **日志可读**：`adb -s 221deeb shell "run-as com.arounder.hifishifter cat logs/android.log"` ✓
- **#4 在真机同样生效**：日志里有 `ort_session[PitchDetector]: model=fcpe.onnx` ✓
  （`fcpe` 之前是要下载的，现在随包）
- **`[HS-VIB]` 计数为 0** ✓ —— 诊断日志已就位、还没被触发

⚠️ **真机两个限制**（本次都撞上了）：

1. **CDP 连不上**（`fetch failed`）—— 推测是 ColorOS 对 `webview_devtools_remote` 的限制。
   模拟器上正常，真机上不行。⇒ **真机上的 UI 自动化只能靠 `adb shell input`**。
2. **设备锁屏时 `screencap` 出来是全黑**（截图只有 15 KB）⇒
   自动化操作前必须先让用户解锁。

⇒ 给 #7 的结论：**别再试图用合成事件 / 自动化重现「长按铅笔开子菜单」了**，
让用户手动操作一次，从 `[HS-VIB]` 日志判断断点。
"""

P.write_text(t[:start] + fixed, encoding="utf-8")
print("✓ ㊴ 节已补回完整内容")
