#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15/#16 收尾：用原生 button（避免 IconButton/tAny 的 import 链），只补 toggleMobilePanel。"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "upstream-src" / "frontend" / "src" / "App.tsx"
a = APP.read_text(encoding="utf-8")

# ── ① 把之前插的 IconButton 版 X 换成原生 button ──────────────────────────
for key in ("timeline", "params", "files", "notes"):
    old = (
        '                                {/* #16：**各面板自己的关闭键** —— 分屏时每块都能独立收起。 */}\n'
        '                                <IconButton\n'
        '                                    size="1"\n'
        '                                    variant="solid"\n'
        '                                    color="gray"\n'
        '                                    className="!absolute right-1 top-1 z-50 opacity-90"\n'
        '                                    aria-label={tAny("close")}\n'
        '                                    data-tooltip={tAny("close")}\n'
        '                                    onClick={() => dispatch(toggleMobilePanel("' + key + '"))}\n'
        '                                >\n'
        '                                    <Cross2Icon />\n'
        '                                </IconButton>\n'
    )
    new = (
        '                                {/* #16：**各面板自己的关闭键** —— 分屏时每块都能独立收起。 */}\n'
        '                                <button\n'
        '                                    type="button"\n'
        '                                    className="hs-panel-close"\n'
        '                                    aria-label="关闭"\n'
        '                                    title="关闭"\n'
        '                                    onClick={() => dispatch(toggleMobilePanel("' + key + '"))}\n'
        '                                >\n'
        '                                    ✕\n'
        '                                </button>\n'
    )
    if a.count(old) == 1:
        a = a.replace(old, new, 1)
        print(f"  ✓ {key}：换成原生 button")

# 顺手把新增的 Cross2Icon import 撤掉（不再需要）
a = re.sub(r'\n?import \{ Cross2Icon \} from "@radix-ui/react-icons";\n', "\n", a, count=1)
# 若被并进了一个多行 import，也去掉那一行
a = re.sub(r'\n    Cross2Icon,(?=\n\})', "", a, count=1)

APP.write_text(a, encoding="utf-8")

# ── ② 补 toggleMobilePanel 的 import ──────────────────────────────────────
head = a.split("export default")[0][:40000]
if "toggleMobilePanel" not in head:
    m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\./features/session/sessionSlice\";", a, re.M)
    if not m:
        m = re.search(r"^import \{([^}]*)\} from \"\./features/session/sessionSlice\";", a, re.M)
    if m:
        a = (a[:m.start()]
             + 'import {' + m.group(1).rstrip() + '\n    toggleMobilePanel,\n} from "./features/session/sessionSlice";'
             + a[m.end():])
        print("✓ import 补 toggleMobilePanel")
    else:
        print("⚠️ 找不到 sessionSlice import，需人工确认")
else:
    print("  · toggleMobilePanel 已有")

APP.write_text(a, encoding="utf-8")

# ── ③ CSS：X 的样式 ───────────────────────────────────────────────────────
CSS = ROOT / "upstream-src" / "frontend" / "src" / "index.css"
c = CSS.read_text(encoding="utf-8")
if "hs-panel-close" not in c:
    c = c.rstrip("\n") + """

/*
 * #15/#16：分屏各面板的关闭键（右上角）。
 *
 * ⚠️ 位置放**右上角**而不是用户说的"左上角"：手机分屏里各面板的左上角
 * 都被内容占满（时间线是拍数栏起点、参数是钢琴键列表顶端），
 * 放那儿会挡住内容且与"点拍数栏 seek"抢点击。右上角是空白区。
 * —— 这点需要跟用户确认。
 */
.hs-panel-close {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 50;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1;
    color: #e5e7eb;
    background: rgb(63 63 70 / 0.85);
    border: 1px solid rgb(255 255 255 / 0.12);
    /* 触屏拖拽/点击不要被浏览器手势吃掉 */
    touch-action: none;
}
.hs-panel-close:active {
    background: rgb(82 82 91 / 0.95);
}
/* 平板 / 桌面不需要（分屏是手机形态的机制）。 */
@media (min-width: 600px) {
    .hs-panel-close {
        display: none;
    }
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ index.css：hs-panel-close")
else:
    print("  · CSS 已有")
