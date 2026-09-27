#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #53 真机逐字验证 + 该验证手法。"""
from pathlib import Path

TEXT = """

## ✅ #53 修正在真机上逐字验证通过（07:45-07:55）

### 验证手法：**在 CDP 里抓 bundle 文本、按关键字定位代码**

比「画一条颤音线看显示」可靠得多 —— 不用构造手势，直接看压缩后的实现：

```js
const r = await fetch('http://tauri.localhost/assets/main-<hash>.js');
const b = await r.text();
b.indexOf('波长');     // 定位到格式化函数，打印周边上下文
```

**实得（压缩后逐字）**：

```js
// 波长
h=>{ const x = (Math.abs(e.endFrame-e.startFrame)+1)/yy;
     return `${(h>1e-6?x/h:0).toFixed(4)} s`; }
// 振幅
h=>`±${s(h).toFixed(2)}`
```

⇒ ✅ **帧数 +1 的修正进了包**；✅ **波长是秒**；✅ **振幅已无「半音」**。

### ⚠️ 这个手法的两个注意点

1. **bundle 文件名带 hash**（如 `main-CPHfvgl1.js`），**每次构建都变** ⇒
   不要硬编码；从 `document.querySelectorAll('script[src]')` 取。
2. **不要用严格正则去匹配源码写法** —— 压缩器会重命名变量、改写引号。
   我先用 `/toFixed\\(4\\)\\s*\\+\\s*" s"/` 匹配**失败**，一度以为没进包；
   改用「关键字定位 + 打印周边 400 字符」后一目了然。

### 📌 通用结论

**想确认「某段前端改动到底进没进 APK」，抓 bundle 文本 + 关键字定位是最快、最确定的手段**
—— 比截图、比构造手势、比看构建日志都直接。

⚠️ 顺带澄清一个容易误判的点：**Tauri 2 的 Android 前端编译进 `.so` 且会压缩**，
所以 **APK 里找不到 `index.html` 是正常的**（`assets/` 只有模型文件）；
但 **webView 实际加载的 bundle 是明文、可以 `fetch` 到的** ⇒ 验证要往后端（bundle）走，
不要在前端（APK 内容）里找。
"""

M = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\.workbuddy\memory\2026-09-22.md")
M.write_text(M.read_text(encoding="utf-8") + TEXT, encoding="utf-8")
print("✓ memory 已追加")

T = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\TASKS.md")
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ #53 修正在真机上逐字验证通过（2026-09-27 07:55）

**手法**：CDP 里 `fetch` bundle 文本，按关键字定位代码（不用构造手势）。

实测压缩后代码：

```js
// 波长
h=>{ const x = (Math.abs(e.endFrame-e.startFrame)+1)/yy; return `${(h>1e-6?x/h:0).toFixed(4)} s`; }
// 振幅
h=>`±${s(h).toFixed(2)}`
```

⇒ ✅ 帧数 +1 进了包 · ✅ 波长是秒 · ✅ 振幅已无「半音」。

📌 **沉淀**：确认「前端改动有没有进 APK」，**抓 bundle + 关键字定位**最直接。
⚠️ Tauri 2 的 Android 前端编译进 `.so` 且压缩 ⇒ **APK 里没有 `index.html` 是正常的**，
但 webView 加载的 bundle **可以 `fetch` 到明文**。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
