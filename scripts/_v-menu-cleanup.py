#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用户口径修正：5 个编辑按钮不要进 v 菜单。

手机上的 ∨ 菜单**不是**另写的一套 UI —— 它只是往 `body` 打
`data-hs-param-menu="open"`，再由 CSS 把参数行整块重排成竖排浮层。
所以我把 5 个编辑按钮加在工具行后，**菜单一开它们也跟着冒出来**。

做法：
1. `BarButton` 支持 `className`（原来只吃固定类名）；
2. 5 个编辑按钮传 `className="hs-edit-btn"`；
3. CSS：`.hs-param-toolrow` 内、菜单打开时隐藏 `.hs-edit-btn`。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")
n = 0

# ── ① BarButton 支持 className ──────────────────────────────────────────────
m = __import__("re").search(r"function BarButton\(\{([^}]*)\}: BarButtonProps\)", t)
assert m, "BarButton 签名锚不唯一"
args = m.group(1)
if "className" not in args:
    t = t[:m.start(1)] + args.rstrip() + ", className" + t[m.end(1):]
    n += 1
    print("✓ BarButton 签名加 className")

old_btn = """            onClick={onClick}
            className="hs-bar-btn"
"""
if old_btn in t:
    t = t.replace(old_btn, """            onClick={onClick}
            className={className ? `hs-bar-btn ${className}` : "hs-bar-btn"}
""", 1)
    n += 1
    print("✓ BarButton 渲染用上 className")
else:
    print("  ⚠️ BarButton 的 className 渲染行没匹配到")

# 类型里加 className?: string
mt = __import__("re").search(r"interface BarButtonProps \{(.*?)\n\}", t, __import__("re").S)
if mt and "className" not in mt.group(1):
    t = t[:mt.end(1)] + "\n    /** 附加类名（用于按场景隐藏/定制，如 v 菜单里隐藏编辑按钮组）。 */\n    className?: string;" + t[mt.end(1):]
    n += 1
    print("✓ BarButtonProps 加 className?")

# ── ② 5 个编辑按钮传 className ──────────────────────────────────────────────
for label in ("ctx_copy", "ctx_cut", "ctx_paste",
              "kb_pianoroll_shift_param_up_selection",
              "kb_pianoroll_shift_param_down_selection"):
    old = f'                label={{t("{label}")}}\n                visual="ghost"\n'
    if t.count(old) == 1:
        t = t.replace(old, f'                label={{t("{label}")}}\n                visual="ghost"\n                className="hs-edit-btn"\n', 1)
        n += 1
    else:
        print(f"  ⚠️ {label} 锚命中 {t.count(old)} 次")

MB.write_text(t, encoding="utf-8")
print(f"✓ MobileBottomBar：{n} 处")

# ── ③ CSS ───────────────────────────────────────────────────────────────────
CSS = FE / "index.css"
c = CSS.read_text(encoding="utf-8")
if "hs-edit-btn" not in c:
    c = c.rstrip("\n") + """

/*
 * 用户口径：D1 的 5 个选区编辑按钮**不进入 v 菜单**。
 *
 * 手机的 ∨ 菜单是把参数行整块重排成竖排浮层（往 body 打
 * `data-hs-param-menu="open"`，见 docs/01 与此文件里的 .hs-param-rows 规则）。
 * 编辑按钮加在工具行上，菜单一开就会跟着冒出来 ⇒ 这里在菜单打开时隐藏它们。
 */
body[data-hs-param-menu="open"] .hs-param-toolrow .hs-edit-btn {
    display: none;
}
"""
    CSS.write_text(c, encoding="utf-8")
    print("✓ index.css：菜单打开时隐藏 .hs-edit-btn")
else:
    print("  · CSS 已存在")
