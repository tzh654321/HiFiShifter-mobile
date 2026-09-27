#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15/#16 参数界面左上角加 X 关闭按钮，并让关闭真正生效。

## 现状

参数面板头部（`.hs-param-head`，`PianoRollPanel` L6453）第一个控件是**同步开关**（🔗），
**没有任何关闭入口** —— 用户只能再去顶栏「视图」菜单取消勾选。

## 做法

在 `.hs-param-head` **最前面**插一个 X 按钮：

- 只在**手机**显示（`< 600px`）—— 平板上参数行是常显的，不需要关闭；
- 点击 ⇒ `dispatch(toggleMobilePanel("params"))`（与顶栏「视图 → 参数面板」同一出口）。

⚠️ 用 CSS 类 `hs-param-close` + 媒体查询控制显隐，不写 `window.innerWidth` 判断 ——
窗口尺寸变化（横竖屏切换）时 CSS 会自动跟上，而 JS 判断只算一次。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

old = """                <Flex align="center" gap="2" className="hs-param-head" style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <IconButton
                        size="1"
                        variant={s.paramEditorSyncTimeline ? "solid" : "ghost"}
                        data-tooltip={tAny("sync_timeline_view_tooltip")}
                        aria-label={tAny("sync_timeline_view")}
                        tabIndex={-1}"""

assert t.count(old) == 1, f"头部锚命中 {t.count(old)} 次"

new = """                <Flex align="center" gap="2" className="hs-param-head" style={{ flex: "1 1 auto", minWidth: 0 }}>
                    {/* #15：参数界面的**关闭键**（左上角 X）。
                        只在手机显示（`hs-param-close` 由 CSS 按宽度控制）——
                        平板上参数行是常显的，没有"关闭"一说。
                        出口与顶栏「视图 → 参数面板」一致 ⇒ `toggleMobilePanel("params")`。 */}
                    <IconButton
                        size="1"
                        variant="ghost"
                        className="hs-param-close"
                        data-tooltip={tAny("close")}
                        aria-label={tAny("close")}
                        tabIndex={-1}
                        onClick={() => dispatch(toggleMobilePanel("params"))}
                    >
                        <Cross2Icon />
                    </IconButton>
                    <IconButton
                        size="1"
                        variant={s.paramEditorSyncTimeline ? "solid" : "ghost"}
                        data-tooltip={tAny("sync_timeline_view_tooltip")}
                        aria-label={tAny("sync_timeline_view")}
                        tabIndex={-1}"""

t = t.replace(old, new, 1)
print("✓ 参数头部加 X 按钮")

# import Cross2Icon + toggleMobilePanel
import re
m = re.search(r'from "@radix-ui/react-icons";', t)
if m:
    # 找到该 import 块开头
    blk = t.rfind("import {", 0, m.start())
    seg = t[blk:m.end()]
    if "Cross2Icon" not in seg:
        t = t[:blk] + seg.replace("import {", "import {\n    Cross2Icon,", 1) + t[m.end():]
        print("  ✓ import Cross2Icon")
else:
    print("  ⚠️ 找不到 radix-icons 的 import")

head = t.split("export function PianoRollPanel")[0] if "export function PianoRollPanel" in t else t[:20000]
if "toggleMobilePanel" not in head:
    m2 = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
    if m2:
        t = t[:m2.start()] + f'import {{{m2.group(1).rstrip()}\n    toggleMobilePanel,\n}} from "../../features/session/sessionSlice";' + t[m2.end():]
        print("  ✓ import toggleMobilePanel")
    else:
        print("  ⚠️ 找不到 sessionSlice import")
else:
    print("  · toggleMobilePanel 已 import")

PP.write_text(t, encoding="utf-8")

# ── CSS：只在手机显示 ──────────────────────────────────────────────────────
CSS = FE / "index.css"
c = CSS.read_text(encoding="utf-8")
if "hs-param-close" not in c:
    c = c.rstrip("\n") + """

/*
 * #15：参数界面的关闭键（左上角 X）—— **只在手机显示**。
 * 平板上参数行常显，没有"关闭"语义。
 * 用 CSS 控制而不是 JS 判断：横竖屏切换时会自动跟上。
 */
.hs-param-close {
    display: none;
}
@media (max-width: 599px) {
    .hs-param-close {
        display: inline-flex;
    }
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ index.css：hs-param-close 只在手机显示")
else:
    print("  · CSS 已存在")
