#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 ABI 覆盖坑 + 模拟器复验结果。"""
from pathlib import Path

M = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\.workbuddy\memory\2026-09-22.md")
M.write_text(M.read_text(encoding="utf-8") + """

## 🔴 大坑：`build-apk.sh <abi>` 会**覆盖** `app-universal-debug.apk`（07:00-07:26）

**症状**：构建 arm64 后把它装进 **x86_64 模拟器** ⇒ app **秒崩**：

```
F libc: Fatal signal 11 (SIGSEGV), fault addr 0x8
        in tid 3951 (ort-prewarm-nsf)      ← ONNX 预热 nsf 的线程
Cause: null pointer dereference
backtrace: #00 pc ... /memfd:exec (deleted)  ← onnxruntime 的 JIT 代码
DEBUG: Guest architecture: 'arm64'           ← ⚠️ 就是这里
nativeloader: Load .../lib/arm64-v8a/libbackend_lib.so ... ok
```

**根因**：`build-apk.sh <abi>` **每次都用同一个输出路径**
（`gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`）
⇒ 构建 arm64 之后，那个文件**已经是 arm64-only 包**；
而模拟器是 x86_64 ⇒ 只能靠 **ARM 转译**跑 ⇒ **onnxruntime 的 JIT 代码在转译下崩**。

⇒ **代码没问题** —— 崩前日志一切正常（`ndk_context 已就绪`、`模型就绪：跳过 5`），
只是崩在预热那一步。

**解法**：装**匹配 ABI**的**归档包** ——
`D:/hifishifter-out/hifishifter-x86_64-debug.apk`（模拟器）/
`hifishifter-arm64-v8a-debug.apk`（真机）。装上后 `PID=4184`，
`ort_session[PitchDetector]: created session ... commit_ms=667` 全部正常。

⚠️ **教训**：
1. **`app-universal-debug.apk` 是易变路径** —— 构建哪个 ABI，它就是哪个。
   **装机前必须确认归档包的 ABI 与设备匹配**，别拿中间产物。
2. **别把这个崩溃当代码 bug**（我一开始差点这么判）——
   先看 tombstone 里的 `DEBUG: Guest architecture` 和设备 ABI 是否一致。

## ✅ 模拟器上复验本轮 UI（07:26）

| 项 | 实测 | 判 |
| :--- | :--- | :--- |
| 「轨道」按钮 | left=96 / w=46 / right=142（视口 360）| ✅ 在栏内 |
| `.hs-panel-close` 数量 | **1**（在 2,47，24×24，`visible`）| ✅ 与 #5 记录「4 → 1」一致 |
| 那个 ✕ 是谁 | `App.tsx:4067` —— **#16 给 timeline 加的**，不归 #5 管 | ✅ 符合「关闭键一律左上角」|

⚠️ **#5 的真实范围**（`TASKS.md:355` 原文）：**只针对「文件管理/记事本」两个面板**
（删它们的左上角 ✕ + 修右上角无效）—— **不是所有面板**。差点又读错一次。

🟡 `#53` 的滑条单位在**空工程**下查不到（参数面板没打开，`hasSecUnit/hasSemitone` 全 false）
⇒ 需导入音频后手测。
""", encoding="utf-8")
print("✓ memory 已追加")
