#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组（轨道列）：**双击轨道 = 展开编辑区**（手机）。

规格（flm 交互表，轨道这一列）：

| 手势 | 行为 | 现状 |
| :--- | :--- | :--- |
| 单击 | 切换轨道 | ✅ 已有 |
| **双击** | **展开全屏编辑** | ← 本步 |
| 划动 | 平移视野 | ✅ 已有 |
| 长按 | 等待长按并划动 | ✅ 已有 |
| 长按并划动 | 右键框选 | ✅ 已有（`handleKernelBoxSelectToParamSelection`）|
| 双指单击 | = 单击非选中轨道 | ⏳ 待做 |

## 为什么空白区没有展开行为

内核里的双击统一在 `if (isDoubleClick)` 分支处理，但**每个分支都依赖
`hit.clip`**（名称区 / 旋钮 / 徽标 / 其他）——
⇒ **双击轨道空白处**（没命中块）落不到任何展开语义上。

## 做法

在**容器级**挂一次双击（手机才生效）：双击时间线区域内任意处
⇒ 把参数面板勾上。与音频块那条同一语义、同一出口，只是覆盖面更广
（这样"双击块"和"双击轨道"在手机上是同一个结果，符合规格表里两列都写"展开全屏编辑"）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                rulerEl.addEventListener("dblclick", onRulerDblClick);
                offs.push(() => rulerEl.removeEventListener("dblclick", onRulerDblClick));"""
assert t.count(old) == 1, "ruler dblclick 锚不唯一"
t = t.replace(old, old + """

                /* E 组（轨道列）：**双击轨道 = 展开编辑区**（手机语义）。
                   内核的双击分支全都依赖 `hit.clip`（名称区/旋钮/徽标/块），
                   **空白处双击没有落点** ⇒ 这里在容器级补一次。
                   与音频块那条同一出口，所以"双击块"与"双击轨道"在手机上结果一致
                   （规格表这两列都写「展开全屏编辑」）。 */
                const timelineContainer = host.getContainer();
                const onTrackDblClickPhone = () => {
                    if (window.innerWidth >= 600) return; // 只手机
                    dispatch(showMobilePanel("params"));
                };
                if (timelineContainer) {
                    timelineContainer.addEventListener("dblclick", onTrackDblClickPhone);
                    offs.push(() =>
                        timelineContainer.removeEventListener("dblclick", onTrackDblClickPhone),
                    );
                }""", 1)
print("✓ TimelinePanel：容器级双击（手机）⇒ 展开参数面板")

TP.write_text(t, encoding="utf-8")

# import showMobilePanel（若缺）
import re
m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if m and "showMobilePanel" not in m.group(1):
    t = t[:m.start()] + f'import {{{m.group(1).rstrip()}\n    showMobilePanel,\n}} from "../../features/session/sessionSlice";' + t[m.end():]
    TP.write_text(t, encoding="utf-8")
    print("  ✓ import 补 showMobilePanel")
else:
    print("  · showMobilePanel import:", "已有" if m and "showMobilePanel" in m.group(1) else "⚠️")
