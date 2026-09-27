#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#12 设置项：是否显示快捷键提示（**默认关**）。

链路：`config.rs`（持久化字段）→ `runtimeThunks`（存）→ `sessionSlice`（状态/默认/reducer/恢复）
→ `MenuBar.shortcutLabel`（唯一的消费点，25 处调用都走它）→ 视图菜单勾选项 → i18n ×5 语种。

⚠️ 关键点：`shortcutLabel` 是**唯一**的渲染入口（25 处调用），所以只要在它的**定义处**
加一行判断就全覆盖了 —— 不用去改那 25 个调用点。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
BE = ROOT / "upstream-src" / "backend" / "src-tauri" / "src"

# ── ① Rust：持久化字段 ────────────────────────────────────────────────────────
cfg = BE / "config.rs"
t = cfg.read_text(encoding="utf-8")
a = """    #[serde(default)]
    pub playhead_zoom: bool,
    #[serde(default)]
    pub auto_scroll: bool,
"""
b = """    #[serde(default)]
    pub playhead_zoom: bool,
    #[serde(default)]
    pub auto_scroll: bool,
    /// 是否在菜单里显示快捷键提示。**默认关**（用户口径）。
    /// `#[serde(default)]` 对 bool 就是 false —— 正合"默认关"，老配置反序列化也安全。
    #[serde(default)]
    pub show_shortcut_hints: bool,
"""
assert t.count(a) == 1, "config 字段锚不唯一"
t = t.replace(a, b, 1)

a2 = """            playhead_zoom: false,
            auto_scroll: false,
"""
b2 = """            playhead_zoom: false,
            auto_scroll: false,
            show_shortcut_hints: false,
"""
assert t.count(a2) == 1, "config 默认值锚不唯一"
t = t.replace(a2, b2, 1)
cfg.write_text(t, encoding="utf-8")
print("✓ config.rs：字段 + 默认值")

# ── ② 前端：持久化（存）──────────────────────────────────────────────────────
th = FE / "features" / "session" / "thunks" / "runtimeThunks.ts"
t = th.read_text(encoding="utf-8")
a = "            playheadZoom: s.playheadZoomEnabled,\n"
b = "            playheadZoom: s.playheadZoomEnabled,\n            showShortcutHints: s.showShortcutHints,\n"
assert t.count(a) == 1, "thunk 锚不唯一"
th.write_text(t.replace(a, b, 1), encoding="utf-8")
print("✓ runtimeThunks.ts：持久化字段")

# ── ③ 前端：sessionSlice（类型/默认/reducer/恢复/导出）────────────────────────
sl = FE / "features" / "session" / "sessionSlice.ts"
t = sl.read_text(encoding="utf-8")

a = """    /** 播放头缩放 */
    playheadZoomEnabled: boolean;
"""
b = """    /** 播放头缩放 */
    playheadZoomEnabled: boolean;
    /** 是否显示菜单里的快捷键提示（默认关） */
    showShortcutHints: boolean;
"""
assert t.count(a) == 1, "slice 类型锚不唯一"
t = t.replace(a, b, 1)

a = """    playheadZoomEnabled: false,
    autoScrollEnabled: false,
"""
b = """    playheadZoomEnabled: false,
    // 用户口径：快捷键提示**默认关**
    showShortcutHints: false,
    autoScrollEnabled: false,
"""
assert t.count(a) == 1, "slice 默认值锚不唯一"
t = t.replace(a, b, 1)

a = """        togglePlayheadZoom(state) {
            state.playheadZoomEnabled = !state.playheadZoomEnabled;
        },
"""
b = """        togglePlayheadZoom(state) {
            state.playheadZoomEnabled = !state.playheadZoomEnabled;
        },
        toggleShortcutHints(state) {
            state.showShortcutHints = !state.showShortcutHints;
        },
"""
assert t.count(a) == 1, "slice reducer 锚不唯一"
t = t.replace(a, b, 1)

a = """                state.playheadZoomEnabled = s.playheadZoom;
"""
b = """                state.playheadZoomEnabled = s.playheadZoom;
                if (s.showShortcutHints != null) state.showShortcutHints = Boolean(s.showShortcutHints);
"""
assert t.count(a) == 1, "slice 恢复锚不唯一"
t = t.replace(a, b, 1)
sl.write_text(t, encoding="utf-8")
print("✓ sessionSlice.ts：类型 / 默认 false / toggleShortcutHints / 恢复")

# 导出 reducer 名（与 togglePlayheadZoom 同一处导出清单）
if "toggleShortcutHints," not in t:
    a = "togglePlayheadZoom,"
    if t.count(a) == 1:
        sl2 = sl.read_text(encoding="utf-8")
        sl2 = sl2.replace(a, "togglePlayheadZoom,\n    toggleShortcutHints,", 1)
        sl.write_text(sl2, encoding="utf-8")
        print("✓ sessionSlice.ts：导出 toggleShortcutHints")
    else:
        print(f"  ⚠ togglePlayheadZoom 在导出清单里出现 {t.count(a)} 次，请手工确认导出")

# ── ④ MenuBar：shortcutLabel 加开关 + 视图菜单加勾选项 ────────────────────────
mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

a = """    function shortcutLabel(actionId: ActionId): string {
        const kb = keybindings[actionId];
"""
b = """    function shortcutLabel(actionId: ActionId): string {
        // 🔴 2026-09-24 用户口径：快捷键提示可关，**默认关**。
        // 这里是**唯一**的渲染入口（全文件 25 处调用都走它），所以只改这一处即可全覆盖。
        if (!s.showShortcutHints) return "";
        const kb = keybindings[actionId];
"""
assert t.count(a) == 1, "shortcutLabel 锚不唯一"
t = t.replace(a, b, 1)

a = """                    <DropdownMenu.Item
                        onSelect={() => {
                            dispatch(toggleTempoMapVisible());
                            void dispatch(persistUiSettings());
                        }}
                    >
                        {withCheck(s.tempoMapVisible, tAny("menu_view_tempo_map"))}
                    </DropdownMenu.Item>
"""
b = """                    <DropdownMenu.Item
                        onSelect={() => {
                            dispatch(toggleTempoMapVisible());
                            void dispatch(persistUiSettings());
                        }}
                    >
                        {withCheck(s.tempoMapVisible, tAny("menu_view_tempo_map"))}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                        onSelect={() => {
                            dispatch(toggleShortcutHints());
                            void dispatch(persistUiSettings());
                        }}
                    >
                        {withCheck(s.showShortcutHints, tAny("options_show_shortcut_hints"))}
                    </DropdownMenu.Item>
"""
assert t.count(a) == 1, "视图菜单锚不唯一"
t = t.replace(a, b, 1)
mb.write_text(t, encoding="utf-8")
print("✓ MenuBar.tsx：shortcutLabel 开关 + 视图菜单勾选项")

print("\n⚠️ 还要：① 在 MenuBar 的 import 里补 toggleShortcutHints；② i18n 加 options_show_shortcut_hints")
