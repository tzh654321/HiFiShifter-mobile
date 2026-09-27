#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：#15 的 X 放错容器（该容器在手机上被 @media 隐藏）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ⚠️ #15 的 X 放错容器：`.hs-param-head` 在手机上**整个被隐藏**

把 X 加进 `.hs-param-head` 后，CDP 查得到它（`display: inline-flex`、`aria-label="关闭"`），
**但截图里看不到** —— 因为：

```css
@media (max-width: 599px) {
    /* 手机把参数头/工具行整个藏掉（这是既有的「竖排浮层」方案的前提） */
    .hs-param-head, .hs-param-toolbar { display: none; }
}
```

⇒ **在手机上看不见的容器里加东西，等于没加。**
CDP 只查了**元素自身的** `getComputedStyle`，没查**祖先是否可见** ——
所以"找到了、display 正常"是**假阳性**。

### 🔑 教训（验证手法）

**判断一个控件"用户能不能看到"，必须查它的 `offsetParent` / 祖先链可见性**，
不能只看它自己的 `display`：

```js
// ✅ 能真正反映"是否可见"
const visible = el.offsetParent !== null || getComputedStyle(el).position === "fixed";
// 更稳：递归检查祖先的 display/visibility，或直接量 getBoundingClientRect().width > 0
```

⚠️ 我这次的判据是 `getComputedStyle(btn).display === "inline-flex"`
⇒ **假阳性**。而 `w: 0, h: 0` **本来是线索** —— 我看到了却没当回事。

### 正确落点（待做）

X 应该放在**手机端实际可见的那个参数面板头部**，而不是 `.hs-param-head`。
需要先查清手机端参数面板的**真实头部容器**是哪个（可能由 `MobilePanelHost`
或分屏槽位渲染），再把 X 放进去。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = "② 参数界面**左上角加 X 关闭按钮**"
if old in t:
    t = t.replace(old, "② 参数界面**左上角加 X 关闭按钮** ⚠️ **已加但放错容器**：X 加进了 `.hs-param-head`，"
                      "而该容器**在手机上被 `@media (max-width:599px)` 整个隐藏** ⇒ 看不见。"
                      "CDP 查元素自身 `display: inline-flex` 是**假阳性**（没查祖先可见性；`w/h = 0` 本是线索）。"
                      "**待改**：找到手机端参数面板的真实头部容器再放。", 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md 已更新")
