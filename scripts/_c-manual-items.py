#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C：把视图菜单里的 4 个面板项从 `.map` 改为手写。

`.map` 版本 tsc 通过、代码也在，但**菜单里没渲染出来**（实测菜单项列表里只有
原有的「文件面板 / 记事本」，我新增的 4 项完全不出现）。
原因未深究（可能是 `as const` 元组 + Radix `DropdownMenu.Item` 的 `key` 处理，
或 `withCheck` 在 map 里被调用时的上下文问题）——
这里改成**手写四段**，与文件里其它菜单项（都是手写）保持同一形式，最保险。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "MenuBar.tsx")
t = P.read_text(encoding="utf-8")

old = """                    {(
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
"""
assert t.count(old) == 1, "map 版锚不唯一"

def item(key: str, label_key: str, var: str) -> str:
    return f"""                    <DropdownMenu.Item
                        onSelect={{() => {{
                            dispatch(toggleMobilePanel("{key}"));
                            void dispatch(persistUiSettings());
                        }}}}
                    >
                        {{withCheck(Boolean({var}), tAny("{label_key}"))}}
                    </DropdownMenu.Item>
"""

new = (item("timeline", "menu_view_panel_timeline", "s.mobilePanels?.timeline")
       + item("params", "menu_view_panel_params", "s.mobilePanels?.params")
       + item("files", "menu_view_panel_files", "s.mobilePanels?.files")
       + item("notes", "menu_view_panel_notes", "s.mobilePanels?.notes"))

t = t.replace(old, new, 1)
P.write_text(t, encoding="utf-8")
print("✓ 4 个面板项改为手写")
