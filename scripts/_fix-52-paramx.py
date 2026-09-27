#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#52 全屏参数界面的 ✕ → 回到全屏轨道界面。

## 现状

`App.tsx` 手机端每个面板左上角都有个 `hs-panel-close` ✕（#16 加的），
`params` 那个调的是 `toggleMobilePanel("params")` —— **只是把自己关掉**。

而 `toggleMobilePanel` 有「至少保留一个」守卫，所以：
- 分屏（timeline + params 都开）时点它 ⇒ 只关 params，timeline 还在 ⇒ **可以**；
- **全屏参数**（只有 params）时点它 ⇒ 守卫拦下（`anyOn` 为 false）⇒ **什么都不发生**
  ⇒ 用户看到的就是「点了没反应」。

用户口径：**全屏参数界面下点 ✕，应该回到全屏轨道界面。**

## 修法

判断「当前是不是只有 params 一个面板」：

```
是  ⇒ 关掉 params **并**强制打开 timeline（= 切到全屏轨道）
不是 ⇒ 按原样只关 params（分屏时仍能单独收起这一块）
```

⚠️ 用 `showMobilePanel`（强制勾上）而不是 `toggleMobilePanel("timeline")` ——
后者是**翻转**，万一 timeline 恰好是开的就会把它关掉。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "upstream-src" / "frontend" / "src" / "App.tsx"
t = APP.read_text(encoding="utf-8")

old = """                        {mobilePanels.params ? (
                            <div className="flex-1 min-h-0 relative">
                                {/* #16：**各面板自己的关闭键** —— 分屏时每块都能独立收起。 */}
                                <button
                                    type="button"
                                    className="hs-panel-close"
                                    aria-label="关闭"
                                    title="关闭"
                                    onClick={() => dispatch(toggleMobilePanel("params"))}
                                >"""

new = """                        {mobilePanels.params ? (
                            <div className="flex-1 min-h-0 relative">
                                {/* #52：用户口径「全屏参数界面下点 ✕ ⇒ 回到全屏轨道界面」。
                                 *
                                 * 分屏时（timeline 也开着）✕ 只收起本块；
                                 * **只有 params 一个**时，除了关它还要强制打开 timeline，
                                 * 否则 `toggleMobilePanel` 的「至少保留一个」守卫会直接忽略
                                 * ⇒ 点了没反应。
                                 *
                                 * ⚠️ 用 `showMobilePanel`（强制勾上）而非 toggle —— 后者是翻转，
                                 * 万一 timeline 恰好开着就会被它关掉。 */}
                                <button
                                    type="button"
                                    className="hs-panel-close"
                                    aria-label="关闭"
                                    title="关闭"
                                    onClick={() => {
                                        const onlyParams =
                                            mobilePanels.params &&
                                            Object.values(mobilePanels).filter(Boolean).length === 1;
                                        dispatch(toggleMobilePanel("params"));
                                        if (onlyParams) dispatch(showMobilePanel("timeline"));
                                    }}
                                >"""

assert t.count(old) == 1, f"锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
APP.write_text(t, encoding="utf-8")
print("✓ #52 params 的 ✕ 改为「全屏时切到轨道」")

# 确认 showMobilePanel 已 import
if "showMobilePanel," not in t and "showMobilePanel }" not in t:
    print("  ⚠ showMobilePanel 可能未 import —— 下一步检查")
else:
    print("  · showMobilePanel 已在 import 里")
