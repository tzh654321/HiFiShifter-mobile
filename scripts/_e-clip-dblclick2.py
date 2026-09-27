#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（音频块列）：双击音频块时，**手机自动把编辑区展开**。

## 现状比想象的完整

`handleKernelDoubleClickClip`（`TimelinePanel.tsx:4242`）已经在做：

```ts
window.dispatchEvent(new CustomEvent("hifi:editOp", {
    detail: { op: "selectClipParamRange", clipId, mode },
}));
```

⇒ 语义就是"**把这个块的时间范围送进参数编辑器**"——
这正是"展开全屏编辑"的实质，**桌面已完成**。

## 手机缺的只是一步

手机上参数面板默认**不显示**（C 组的分屏机制：默认只勾「轨道面板」）⇒
双击块之后，参数编辑器里的选区更新了，**但用户看不到**（面板没开）。

⇒ 补一行：**手机端双击块时，顺手把参数面板勾上**（`showMobilePanel("params")`）。

⚠️ 音频块是 **canvas 绘制**的（没有 DOM 节点），所以不能在 DOM 上挂双击监听 ——
必须走内核给的这个回调。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """    const handleKernelDoubleClickClip = React.useCallback(
        (clipId: string, mode: "replace" | "toggle" = "replace") => {
            clearContextMenu();
            window.dispatchEvent(
                new CustomEvent("hifi:editOp", {
                    // mode 缺省 replace（不传即旧行为）；按住
                    // `modifier.clipRangeToParamSelection`（默认 Alt）双击时内核
                    // 传 "toggle"，由参数编辑器并入 / 挖掉该块范围。
                    detail: { op: "selectClipParamRange", clipId, mode },
                }),
            );
        },
        [clearContextMenu],
    );"""

assert t.count(old) == 1, "handleKernelDoubleClickClip 锚不唯一"
t = t.replace(old, """    const handleKernelDoubleClickClip = React.useCallback(
        (clipId: string, mode: "replace" | "toggle" = "replace") => {
            clearContextMenu();
            /* E 组（音频块列）：**双击 = 展开全屏编辑**。
               桌面语义（把块范围送进参数编辑器）已经由下面这条事件完成；
               但手机上参数面板默认不显示（C 组的分屏机制默认只开轨道面板），
               用户双击后「选区变了却看不见」。
               ⇒ 顺手把参数面板勾上，等价于"展开编辑区"。 */
            if (isPhoneLike()) dispatch(showMobilePanel("params"));
            window.dispatchEvent(
                new CustomEvent("hifi:editOp", {
                    // mode 缺省 replace（不传即旧行为）；按住
                    // `modifier.clipRangeToParamSelection`（默认 Alt）双击时内核
                    // 传 "toggle"，由参数编辑器并入 / 挖掉该块范围。
                    detail: { op: "selectClipParamRange", clipId, mode },
                }),
            );
        },
        [clearContextMenu, dispatch],
    );""", 1)
print("✓ handleKernelDoubleClickClip：手机端自动展开参数面板")

# isPhoneLike 辅助（用与 layoutMode 一致的口径：<600 视为手机）
if "function isPhoneLike" not in t:
    anchor = "    const handleKernelDoubleClickClip = React.useCallback("
    t = t.replace(anchor, """    /**
     * 手机形态判定（与 `utils/layoutMode` 的口径一致：宽度 < 600）。
     * 这里不 import 那个模块是为了避免给 TimelinePanel 增加依赖 ——
     * 只看一眼视口宽度即可。
     */
    const isPhoneLike = () => window.innerWidth < 600;

""" + anchor, 1)
    print("✓ 加 isPhoneLike 辅助")

TP.write_text(t, encoding="utf-8")

# import showMobilePanel
import re
m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if m and "showMobilePanel" not in m.group(1):
    t = t[:m.start()] + f'import {{{m.group(1).rstrip()}\n    showMobilePanel,\n}} from "../../features/session/sessionSlice";' + t[m.end():]
    TP.write_text(t, encoding="utf-8")
    print("  ✓ import 补 showMobilePanel")
else:
    print("  · showMobilePanel import:", "已有" if m and "showMobilePanel" in m.group(1) else "⚠️ 结构不同")
