#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#5 完整修复：删左上角 ✕ + 让右上角关闭键在手机端生效。

## 已查清的事实

| 位置 | 关闭键 | 调什么 | 手机端有效？ |
| :--- | :--- | :--- | :--- |
| `App.tsx` 手机端渲染 | **左上角** `hs-panel-close`（#16 加的）| `toggleMobilePanel(key)` | ✅ |
| `FileBrowserPanel` 右上角 | `IconButton`+`Cross2Icon` | `setVisible(false)`（`fileBrowser.visible`）| ❌ |
| `NotebookPanel` 右上角 | 按钮 `t("close")` | `closeNotebook()`（`notebook.*`）| ❌ |

**为什么无效**：#17 把底栏页签改成 redux 勾选项后，手机端面板显隐看的是
`session.mobilePanels`，而这两个组件改的是**自己 slice 的 visible**
（那是桌面/平板的权威）⇒ 手机端点上去毫无反应。

## 修法

1. **删掉左上角两个按钮**（用户口径：右上角已经有「关闭」了，左上角别再放叉）；
2. 右上角那两处**保留原 dispatch**（桌面/平板还得靠它），**额外派发**
   `hs-mobile-close-panel` 事件；`App` 监听 → 只在 `isTouchShell` 时
   `toggleMobilePanel(key)`。

⇒ 桌面/平板：原逻辑一字未动；手机端：两处状态一起关，行为正确。
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "upstream-src" / "frontend" / "src"
APP = SRC / "App.tsx"

t = APP.read_text(encoding="utf-8")

# ── ① 删 App.tsx 里两个左上角 ✕ ─────────────────────────────────────────
removed = 0
for key in ("files", "notes"):
    pat = re.compile(
        r'\{/\* #16：\*\*各面板自己的关闭键\*\*[^*]*\*/\}\s*'
        r'<button\s+type="button"\s+className="hs-panel-close"\s+'
        r'aria-label="关闭"\s+title="关闭"\s+'
        r'onClick=\{\(\) => dispatch\(toggleMobilePanel\("' + key + r'"\)\)\}\s*>\s*'
        r'✕\s*</button>\s*\n',
        re.S,
    )
    t, n = pat.subn("", t)
    removed += n
print(f"✓ ① 删掉左上角 ✕ 共 {removed} 处")
assert removed == 2, f"应删 2 处，实际 {removed}"

# ── ② App.tsx 加关闭事件桥（用 isTouchShell 守卫，不碰 store 内部）──────
old = """    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobilePanelKey }>).detail?.tab;"""
new = """    /**
     * #5：**手机端「右上角关闭键」的事件桥**。
     *
     * `FileBrowserPanel` / `NotebookPanel` 的 ✕ 改的是**自己 slice 的 visible**
     * （桌面/平板的权威）。#17 之后手机端的面板显隐看 `session.mobilePanels`
     * ⇒ 这两个 ✕ 在手机上点了没反应。这里收到事件补一个 `toggleMobilePanel`。
     *
     * ⚠️ 只在 `isTouchShell` 时理会 —— 桌面端根本没有 mobilePanels 这回事，
     * 它的面板显隐仍由各自的 `*.visible` 决定（那两处的 `dispatch` 已保留）。
     */
    useEffect(() => {
        if (!isTouchShell) return;
        const onClosePanel = (e: Event) => {
            const key = (e as CustomEvent<{ key?: MobilePanelKey }>).detail?.key;
            if (key) dispatch(toggleMobilePanel(key));
        };
        window.addEventListener("hs-mobile-close-panel", onClosePanel);
        return () => window.removeEventListener("hs-mobile-close-panel", onClosePanel);
    }, [dispatch, isTouchShell]);

    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobilePanelKey }>).detail?.tab;"""
assert t.count(old) == 1, f"② 锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
APP.write_text(t, encoding="utf-8")
print("✓ ② App 加了关闭事件桥（isTouchShell 守卫）")

# ── ③ FileBrowserPanel 的 ✕ 补派发 ──────────────────────────────────────
FB = SRC / "components" / "layout" / "FileBrowserPanel.tsx"
t = FB.read_text(encoding="utf-8")
old = """                        data-tooltip={t("fb_close")}
                        onClick={() => dispatch(setVisible(false))}
                    >"""
new = """                        data-tooltip={t("fb_close")}
                        onClick={() => {
                            dispatch(setVisible(false));
                            /* #5：手机端面板显隐看 `session.mobilePanels`，
                               补一个事件让 App 一并收起（桌面端不听，无副作用）。 */
                            window.dispatchEvent(
                                new CustomEvent("hs-mobile-close-panel", {
                                    detail: { key: "files" },
                                }),
                            );
                        }}
                    >"""
assert t.count(old) == 1, f"③ 锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
FB.write_text(t, encoding="utf-8")
print("✓ ③ FileBrowserPanel 的 ✕ 补派发")

# ── ④ NotebookPanel 的「关闭」补派发 ────────────────────────────────────
NB = SRC / "components" / "layout" / "NotebookPanel.tsx"
t = NB.read_text(encoding="utf-8")
old = """                        onClick={() => dispatch(closeNotebook())}
                    >
                        {t("close")}"""
new = """                        onClick={() => {
                            dispatch(closeNotebook());
                            /* #5：同上，让手机端的 `mobilePanels.notes` 一起关。 */
                            window.dispatchEvent(
                                new CustomEvent("hs-mobile-close-panel", {
                                    detail: { key: "notes" },
                                }),
                            );
                        }}
                    >
                        {t("close")}"""
assert t.count(old) == 1, f"④ 锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
NB.write_text(t, encoding="utf-8")
print("✓ ④ NotebookPanel 的「关闭」补派发")
