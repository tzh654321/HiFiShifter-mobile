#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（音频块列）：**双击音频块 = 展开全屏编辑**。

规格（flm 交互表，音频块这一列）：

| 手势 | 行为 | 现状 |
| :--- | :--- | :--- |
| 单击 | 选中并显示常用操作与左右控制点 | ✅ 已有 |
| **双击** | **展开全屏编辑** | ← 本步 |
| 划动 | 未选中=平移 / 已选中=拖动块 | ✅ 已有 |
| 长按 | 打开淡入淡出菜单 | ✅ 已有（长按上下文菜单，`0005` 补丁）|
| 长按并划动 | 拖动块 | ✅ 已有 |

## "展开全屏编辑"在手机上的对应物

手机没有"全屏窗口"，但 C 组已经做了**垂直分屏**（`mobilePanels`）。
⇒ 双击音频块 = **把参数面板勾上**（若已开就保持），即"把编辑区展开到可见"。

⚠️ **不能复用 `handleKernelDoubleClickClip`** —— 它已经绑给"并入参数选区"了
（那是桌面的既有语义）。所以这里**另挂一个只对手机生效的双击监听**，
桌面行为完全不变。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                rulerEl.addEventListener("dblclick", onRulerDblClick);
                offs.push(() => rulerEl.removeEventListener("dblclick", onRulerDblClick));"""
assert t.count(old) == 1, "dblclick 锚不唯一"
t = t.replace(old, old + """

                /* E 组（音频块列）：**双击音频块 = 展开编辑区**（手机语义）。
                   ⚠️ 只在手机生效 —— 桌面双击已有既有语义（并入参数选区），
                   不能覆盖。手机上是「把参数面板勾上」，即 C 组做的垂直分屏。 */
                const onClipDblClickPhone = (e: MouseEvent) => {
                    if (!isPhoneRef.current) return;
                    const target = e.target as HTMLElement | null;
                    if (!target?.closest("[data-clip-id]")) return; // 只认音频块
                    dispatch(showMobilePanel("params"));
                };
                container.addEventListener("dblclick", onClipDblClickPhone);
                offs.push(() => container.removeEventListener("dblclick", onClipDblClickPhone));""", 1)
print("✓ TimelinePanel：手机双击音频块 ⇒ 展开参数面板")

TP.write_text(t, encoding="utf-8")

# isPhoneRef：需要有个 ref 或直接读 store（若无则补）
if "isPhoneRef" not in t:
    print("  ⚠️ isPhoneRef 不存在，需补；下面单独处理")
if "showMobilePanel" not in t.split("export function")[0]:
    print("  ⚠️ showMobilePanel 未 import，需补")
