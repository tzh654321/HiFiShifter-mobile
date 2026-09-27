#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C 第二半：App.tsx 的 import + 「视图」菜单加 4 个勾选项。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① App.tsx：import showMobilePanel / MobilePanelKey ──────────────────────
A = FE / "App.tsx"
t = A.read_text(encoding="utf-8")
import re
m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\./features/session/sessionSlice\";", t, re.M)
if not m:
    m = re.search(r'^import \{([^}]*)\} from "\./features/session/sessionSlice";', t, re.M)
assert m, "找不到 sessionSlice import"
have = m.group(1)
if "showMobilePanel" not in have:
    t = t[:m.start()] + f'import {{{have.rstrip()}\n    showMobilePanel,\n}} from "./features/session/sessionSlice";' + t[m.end():]
    print("✓ App.tsx：import 补 showMobilePanel")

if "MobilePanelKey" not in t.split("export default")[0][:6000]:
    # 挂到 sessionTypes 的 import 或新增
    m2 = re.search(r'^import type \{([^}]*)\} from "\./features/session/sessionTypes";', t, re.M)
    if m2:
        t = t[:m2.start()] + f'import type {{{m2.group(1).rstrip()}, MobilePanelKey }} from "./features/session/sessionTypes";' + t[m2.end():]
    else:
        anchor = 'import { useCallback, useEffect, useMemo, useRef, useState } from "react";'
        if anchor in t:
            t = t.replace(anchor, anchor + '\nimport type { MobilePanelKey } from "./features/session/sessionTypes";', 1)
    print("✓ App.tsx：MobilePanelKey import")
A.write_text(t, encoding="utf-8")

# ── ② MenuBar：视图菜单加 4 个勾选项 ────────────────────────────────────────
M = FE / "components/layout/MenuBar.tsx"
t = M.read_text(encoding="utf-8")

# 找视图菜单里已有的 withCheck 项（tempoMapVisible）作为锚点，插到它前面
anchor = """                    <DropdownMenu.Item
                        onSelect={() => {
                            dispatch(toggleTempoMapVisible());"""
assert t.count(anchor) == 1, "视图菜单锚不唯一"

GROUP = """                    {/* C（#17）：手机端四个面板的显隐（取代底栏页签）。
                        勾几个就垂直分几块；`toggleMobilePanel` 保证至少留一个。 */}
                    <DropdownMenu.Separator />
                    {(
                        [
                            ["timeline", "menu_view_panel_timeline"],
                            ["params", "menu_view_panel_params"],
                            ["files", "menu_view_panel_files"],
                            ["notes", "menu_view_panel_notes"],
                        ] as const
                    ).map(([key, labelKey]) => (
                        <DropdownMenu.Item
                            key={key}
                            onSelect={() => {
                                dispatch(toggleMobilePanel(key));
                                void dispatch(persistUiSettings());
                            }}
                        >
                            {withCheck(Boolean(s.mobilePanels?.[key]), tAny(labelKey))}
                        </DropdownMenu.Item>
                    ))}
                    <DropdownMenu.Separator />
"""
t = t.replace(anchor, GROUP + anchor, 1)
print("✓ MenuBar：视图菜单加了 4 个面板勾选项")

# import toggleMobilePanel
m3 = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if not m3:
    m3 = re.search(r'^import \{([^}]*)\} from "\.\./\.\./features/session/sessionSlice";', t, re.M)
if m3 and "toggleMobilePanel" not in m3.group(1):
    t = t[:m3.start()] + f'import {{{m3.group(1).rstrip()}\n    toggleMobilePanel,\n}} from "../../features/session/sessionSlice";' + t[m3.end():]
    print("  ✓ MenuBar：import 补 toggleMobilePanel")
M.write_text(t, encoding="utf-8")

# ── ③ i18n ──────────────────────────────────────────────────────────────────
for f, vals in (("zh-CN.ts", {"menu_view_panel_timeline": "轨道面板",
                              "menu_view_panel_params": "参数面板",
                              "menu_view_panel_files": "文件浏览器",
                              "menu_view_panel_notes": "记事本"}),
                ("en-US.ts", {"menu_view_panel_timeline": "Timeline Panel",
                              "menu_view_panel_params": "Param Editor",
                              "menu_view_panel_files": "File Browser",
                              "menu_view_panel_notes": "Notebook"})):
    Q = FE / "i18n" / f
    tt = Q.read_text(encoding="utf-8")
    add = [f'    {k}: "{v}",' for k, v in vals.items() if f"{k}:" not in tt]
    if add:
        a = '    mobile_tool_menu: '
        assert tt.count(a) == 1, f"{f} 锚不唯一"
        tt = tt.replace(a, "\n".join(add) + "\n" + a, 1)
        Q.write_text(tt, encoding="utf-8")
        print(f"✓ {f}: 补了 {len(add)} 个面板名")
    else:
        print(f"  · {f} 已齐")
