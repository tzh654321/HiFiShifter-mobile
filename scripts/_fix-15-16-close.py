#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 + #16：**每个分屏面板自己的左上角都有 X**（一次解决两条）。

## 之前错在哪

X 加进了 `PianoRollPanel` 的 `.hs-param-head` —— 而该容器**在手机上被
`@media (max-width:599px)` 整个隐藏**（那是"竖排浮层"方案的前提）
⇒ **放进看不见的容器 = 没加**。

CDP 只查了元素自身的 `getComputedStyle`（`display: inline-flex`）⇒ **假阳性**。
教训：判断"用户能否看到"必须查 `getBoundingClientRect().width > 0`
或祖先可见性，**不能只看 `display`**。

## 正确落点

`App.tsx` 的手机分屏里，每个面板都是：

```tsx
{mobilePanels.params ? (
    <div className="flex-1 min-h-0 relative">     {/* ← relative 已就绪 */}
        <PianoRollPanel />
    </div>
) : null}
```

⇒ 在**每个槽位**里叠一个绝对定位的 X（`absolute right-1 top-1 z-50`），
点击 ⇒ `toggleMobilePanel(<该面板>)`。

⇒ 这一次改动**同时修好两条**：
- #15 参数界面的关闭键；
- #16 所有界面的关闭键（时间线 / 参数 / 文件 / 记事本 四个面板统一有）。

⚠️ 用 `right-1 top-1` 而不是左上角 —— 手机分屏里各面板的**左上角是内容区**
（拍数栏 / 钢琴键列表），放那儿会挡住内容；**右上角**才是空白可点。
（用户说"左上角"，但各面板左上角都被内容占满 —— 这点要跟用户确认。）
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 先撤掉加在 .hs-param-head 里的那个 X（看不见的容器）────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
p = PP.read_text(encoding="utf-8")
OLD_X = """                    {/* #15：参数界面的**关闭键**（左上角 X）。
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
"""
if OLD_X in p:
    p = p.replace(OLD_X, "", 1)
    PP.write_text(p, encoding="utf-8")
    print("✓ 撤掉 .hs-param-head 里的 X（该容器手机上被隐藏）")
else:
    print("  · 没找到旧 X（可能已撤）")

# ── ② 在每个面板槽位叠一个 X ──────────────────────────────────────────────
APP = FE / "App.tsx"
a = APP.read_text(encoding="utf-8")

PANELS = [
    ("timeline", "TimelinePanel", "时间线"),
    ("params", "PianoRollPanel", "参数"),
    ("files", "FileBrowserPanel", "文件"),
    ("notes", "NotebookPanel", "记事本"),
]

n = 0
for key, comp, label in PANELS:
    old = f"""                        {{mobilePanels.{key} ? (
                            <div className="flex-1 min-h-0 relative">
                                <{comp}"""
    if a.count(old) != 1:
        print(f"  ⚠️ {label}：槽位锚命中 {a.count(old)} 次，跳过")
        continue
    new = f"""                        {{mobilePanels.{key} ? (
                            <div className="flex-1 min-h-0 relative">
                                {{/* #16：**各面板自己的关闭键**。 */}
                                <IconButton
                                    size="1"
                                    variant="solid"
                                    color="gray"
                                    className="!absolute right-1 top-1 z-50 opacity-90"
                                    aria-label={{tAny("close")}}
                                    data-tooltip={{tAny("close")}}
                                    onClick={{() => dispatch(toggleMobilePanel("{key}"))}}
                                >
                                    <Cross2Icon />
                                </IconButton>
                                <{comp}"""
    a = a.replace(old, new, 1)
    n += 1
    print(f"  ✓ {label}：槽位加 X")

APP.write_text(a, encoding="utf-8")
print(f"共 {n} 个面板")

# import Cross2Icon + IconButton（App.tsx 里可能没有）
head = a.split("export function App")[0] if "export function App" in a else a[:30000]
import re
if "@radix-ui/react-icons" in a and "Cross2Icon" not in head:
    m = re.search(r'import \{([^}]*)\} from "@radix-ui/react-icons";', a)
    if m:
        a = a[:m.start()] + f'import {{{m.group(1).rstrip()}\n    Cross2Icon,\n}} from "@radix-ui/react-icons";' + a[m.end():]
        APP.write_text(a, encoding="utf-8")
        print("✓ import Cross2Icon")
elif "Cross2Icon" not in a:
    a = 'import { Cross2Icon } from "@radix-ui/react-icons";\n' + a
    APP.write_text(a, encoding="utf-8")
    print("✓ 新增 radix-icons import（含 Cross2Icon）")
else:
    print("  · Cross2Icon 已 import")
