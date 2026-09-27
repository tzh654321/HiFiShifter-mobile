#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D3 修复：参数编辑器拍数栏触摸点不动（选区后也无法改进度条）。

## 根因（读代码确认）

`pianoRoll/usePianoRollInteractions.ts` 的 `onRulerMouseDown` 第一行：

```ts
if (isLegacyMouseEventFromStylus()) return;
```

而 `utils/penInput.ts:209`：

```ts
export function isLegacyMouseEventFromStylus(): boolean {
    return kind === "pen" || kind === "touch";     // ← touch 也返回 true
}
```

⇒ 触摸下这条路径直接被掐掉；参数编辑器又**没有** pointer 专用路径
（2026-09-22 只给**时间线**加了 `bindRulerTouchSeek`）⇒ 手机上点拍数栏毫无反应。
**与"有没有选区"无关**（用户观察到的相关性是巧合）。

## 为什么用最小改法

时间线那套复杂，是因为轨道界面上**横向划拍数栏要平移视口**，必须"等位移说话"。
参数编辑器**没有这个语义冲突**：拍数栏就是纯时间定位，
原桌面实现「按下即 seek + 拖动持续 seek」正是触屏想要的。
⇒ 只需**放行 touch**（保留 pen 的拦截 —— 笔悬停会发兼容 mouse 事件，
放进来会让"悬停画线起笔"误移播放头）。

⚠️ 另补**双指让位**：`window.__hsGestureActive`（手势层置位）为真时不 seek。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

old = """            // 数位笔 / 触摸不触发标尺 seek：pen 的兼容 mouse 事件（无
            // pointerType）会让"悬停画线起笔"误定位播放头；悬停时间气泡
            // （只读）不受影响。按"最近一次真实 pointer 事件"的设备类型判定。
            if (isLegacyMouseEventFromStylus()) return;
            if (e.button !== 0) return;"""

new = """            // 数位笔不触发标尺 seek：pen 的兼容 mouse 事件（无 pointerType）会让
            // "悬停画线起笔"误定位播放头；悬停时间气泡（只读）不受影响。
            //
            // 🔴 2026-09-25 修（TASKS #D3）：原来这里是 `isLegacyMouseEventFromStylus()`，
            // 而它在 `penInput.ts:209` 对 **touch 也返回 true** ⇒ 手机上点拍数栏
            // **完全没反应**（参数编辑器没有时间线那套 pointer 专用路径）。
            // 现在只拦 pen；touch 的兼容鼠标事件坐标正常，
            // 「按下即 seek + 拖动持续 seek」正是触屏想要的行为。
            if (pointerKindOf(lastRealPointerType()) === "pen") return;
            // 双指手势期间让位（缩放/平移优先，别被拍数栏抢事件）。
            if ((window as unknown as { __hsGestureActive?: boolean }).__hsGestureActive) return;
            if (e.button !== 0) return;"""

assert t.count(old) == 1, "拦截锚不唯一"
t = t.replace(old, new, 1)
print("✓ onRulerMouseDown：只拦 pen + 双指让位")

# ── 确认 import ─────────────────────────────────────────────────────────────
import re
m = re.search(r'import \{([^}]*)\} from "\.\./\.\./\.\./utils/penInput";', t)
have = m.group(1) if m else ""
print(f"  现有 penInput import: {have.strip()[:120]}")

need = [n for n in ("pointerKindOf", "lastRealPointerType") if n not in have]
if need:
    if m:
        t = t[:m.start()] + f'import {{{have.rstrip()}, {", ".join(need)} }} from "../../../utils/penInput";' + t[m.end():]
        print(f"  ✓ import 补充：{need}")
    else:
        # 没有 penInput import ⇒ 新增一条
        anchor = 'import { useCallback, useEffect, useRef } from "react";'
        assert t.count(anchor) == 1
        t = t.replace(anchor, anchor + '\nimport { pointerKindOf, lastRealPointerType } from "../../../utils/penInput";', 1)
        print("  ✓ 新建 penInput import")
else:
    print("  · import 已齐")

P.write_text(t, encoding="utf-8")
print("✓ 完成")
