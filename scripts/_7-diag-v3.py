#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 诊断 v3：改用后端 `log_frontend_error` 命令写日志。

**为什么前两版日志都是空的**：
- v1 用 `console.warn` ⇒ 不会被转发；
- v2 改成 `console.error` ⇒ **实测真机日志里依然没有 `HS-VIB`** ⇒
  推测只有 **uncaught 异常**（window.onerror / unhandledrejection）才走转发，
  普通的 `console.*` 调用不在其列。

⇒ 正解：**直接 invoke 后端命令**。
上游 `commands/diagnostics.rs:196` 有 `log_frontend_error(message, detail)`，
就是给前端回传诊断用的。改成调它，日志一定能落到 `logs/android.log`。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

# ── ① 加 import ─────────────────────────────────────────────────────────────
if "log_frontend_error" not in t:
    anchor = 'import { useCallback, useEffect, useRef } from "react";'
    assert t.count(anchor) == 1, "import 锚不唯一"
    t = t.replace(anchor, anchor + '\nimport { invoke as tauriInvoke } from "../../../services/api/invoke";', 1)
    print("✓ 加了 invoke import")

# ── ② 插入 helper + 替换所有 console.error/warn 的 HS-VIB 调用 ───────────────
helper = '''
/**
 * #7 诊断：把消息送到后端日志（`logs/android.log`）。
 *
 * ⚠️ 踩过两次：`console.warn` / `console.error` **都不会**被转发到后端 ——
 * 上游只转发 uncaught 异常。所以这里直接 invoke `log_frontend_error`（见 `diagnostics.rs:196`）。
 */
function vibLog(msg: string): void {
    try {
        void tauriInvoke("log_frontend_error", { message: `[HS-VIB] ${msg}`, detail: null });
    } catch {
        /* 诊断失败不影响功能 */
    }
}
'''
# 放在文件里第一个 export 之前
import re
m = re.search(r"^export ", t, re.M)
assert m, "找不到第一个 export"
t = t[:m.start()] + helper.lstrip("\n") + "\n" + t[m.start():]
print("✓ 插入 vibLog helper")

# 把 console.error(...) / console.warn(...) 的 HS-VIB 调用替换成 vibLog(...)
before = t.count("[HS-VIB]")
# 单行形式：console.error('[HS-VIB] xxx');  →  vibLog('xxx');
t = re.sub(r"console\.(?:error|warn)\(\s*(?:`|')" + re.escape("[HS-VIB] ") + r"([^`']*)(?:`|')[,]?\s*\);",
           lambda mm: f"vibLog('{mm.group(1).replace(chr(39), chr(34))}');", t)
# 模板字符串形式（含 ${}）：console.error(\n `[HS-VIB] xxx`,\n );  → 保留成 vibLog(`...`)
t = re.sub(r"console\.(?:error|warn)\(\s*`\[HS-VIB\] ([^`]*)`\s*,?\s*\);",
           lambda mm: "vibLog(`" + mm.group(1) + "`);", t)
after = t.count("[HS-VIB]")
print(f"✓ HS-VIB 提及数 {before} → {after}（剩下的应是 vibLog 内的前缀拼接）")

# 兜底：还有残留的 console.error('[HS-VIB'
left = t.count("console.error('[HS-VIB") + t.count('console.error("[HS-VIB') + t.count("console.warn('[HS-VIB")
print(f"  ⚠️ 残留 console 形式：{left}")

P.write_text(t, encoding="utf-8")
print("\n下一步：tsc → 构建 arm64 → 装真机 → 用户操作 → 读日志（这次一定有）")
