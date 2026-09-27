#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D4 第二部分：选择按钮加角标 + 菜单 + 手套图标 + i18n。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")
n = 0

# ── ① 图标：手套 + 带角标的选择光标 ─────────────────────────────────────────
ICONS = '''
/**
 * D4：「拖动」工具图标（手套）。
 *
 * 语义 = 只导航视野、不编辑内容（参数区缩放/单指平移），
 * 与「选择」的分工是"不动选区与参数"。
 */
function IconGlove({ width = 15, height = 15 }: { width?: number; height?: number }) {
    return (
        <svg width={width} height={height} viewBox="0 0 15 15" fill="none">
            {/* 手掌 + 四指 */}
            <path
                d="M4.6 7.2V3.9a1.05 1.05 0 0 1 2.1 0v2.6M6.7 6.5V2.9a1.05 1.05 0 0 1 2.1 0v3.6M8.8 6.6V3.6a1.05 1.05 0 0 1 2.1 0v3.5M10.9 7.3V5.2a1.05 1.05 0 0 1 2.1 0v4.3c0 2-1.6 3.6-3.6 3.6H8.1c-1 0-1.9-.4-2.6-1.1L3 9.5a1.05 1.05 0 0 1 1.5-1.5l.1.1"
                stroke="currentColor"
                strokeWidth="1.15"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </svg>
    );
}

/** 选择工具图标 + 右下角标（与 `IconPencilWithCorner` 同款 6×6 三角，语义=「还有别的工具」）。 */
function IconCursorWithCorner({ drag }: { drag?: boolean }) {
    return (
        <span style={{ position: "relative", width: 16, height: 16, display: "block" }}>
            <span
                style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {drag ? <IconGlove width={16} height={16} /> : <CursorArrowIcon width={16} height={16} />}
            </span>
            <span
                data-hs-select-corner
                style={{
                    position: "absolute",
                    right: -1,
                    bottom: -1,
                    width: 6,
                    height: 6,
                    opacity: 0.7,
                }}
            >
                <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
                    <path d="M0 6L6 0V6Z" fill="currentColor" />
                </svg>
            </span>
        </span>
    );
}

/**
 * D4：「选择」工具子菜单（点角标 / 长按打开）。
 * 结构与 `DrawToolMenu` 一致（fixed 定位 + 量锚点 + 夹进视口），避免两处漂移。
 */
function SelectToolMenu({
    current,
    onPick,
    onClose,
}: {
    current: string;
    onPick: (mode: "select" | "drag") => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const rows: Array<{ mode: "select" | "drag"; label: string; icon: React.ReactNode }> = [
        { mode: "select", label: t("mobile_tool_select"), icon: <CursorArrowIcon width={15} height={15} /> },
        { mode: "drag", label: t("mobile_tool_drag"), icon: <IconGlove /> },
    ];
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({
        position: "fixed",
        left: 8,
        bottom: 8,
        visibility: "hidden",
        zIndex: 41,
    });

    /* 与 DrawToolMenu 同样的「量一次锚点、优先向下弹、放不下向上、横向夹进视口」。 */
    React.useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const M = 8;
        const anchor = document.querySelector<HTMLElement>("[data-hs-select-anchor]");
        const r = anchor?.getBoundingClientRect();
        if (!r) {
            setMenuStyle((s) => ({ ...s, visibility: "visible" }));
            return;
        }
        const box = el.getBoundingClientRect();
        const below = window.innerHeight - r.bottom - M;
        const top = below >= box.height ? r.bottom + 6 : Math.max(M, r.top - box.height - 6);
        const left = Math.min(Math.max(M, r.left), Math.max(M, window.innerWidth - box.width - M));
        setMenuStyle({ position: "fixed", left, top, visibility: "visible", zIndex: 41 });
    }, []);

    return (
        <div ref={menuRef} className="hs-select-tool-menu" data-hs-select-tool-menu style={menuStyle}>
            {rows.map((row) => (
                <button
                    key={row.mode}
                    type="button"
                    className="hs-select-tool-menu__item"
                    data-active={current === row.mode ? "true" : undefined}
                    onClick={() => {
                        onPick(row.mode);
                        onClose();
                    }}
                >
                    {row.icon}
                    <span>{row.label}</span>
                </button>
            ))}
        </div>
    );
}

'''
anchor2 = "/** 绘制工具子菜单（点铅笔右下角三角 / 长按铅笔打开）。 */"
assert t.count(anchor2) == 1, "DrawToolMenu 注释锚不唯一"
t = t.replace(anchor2, ICONS.strip() + "\n\n" + anchor2, 1)
n += 1
print("✓ 加了 IconGlove / IconCursorWithCorner / SelectToolMenu")

# ── ② state + 长按 + 点角标 ─────────────────────────────────────────────────
old_state = "    const [drawMenuOpen, setDrawMenuOpen] = React.useState(false);"
assert t.count(old_state) == 1, "state 锚不唯一"
t = t.replace(old_state, old_state + "\n    const [selectMenuOpen, setSelectMenuOpen] = React.useState(false);", 1)
n += 1

old_open = """    const openDrawMenu = () => {
        clearDrawLongPress();
        setEyeOpen(false);
        setVOpen(false);
        setDrawMenuOpen(true);
    };"""
assert t.count(old_open) == 1, "openDrawMenu 锚不唯一"
t = t.replace(old_open, old_open + """

    /* D4：选择工具的角标/长按 —— 与铅笔同一套（400ms、mouse 不接管）。 */
    const selectLongPressRef = React.useRef<number | null>(null);
    const selectLongFiredRef = React.useRef(false);
    const clearSelectLongPress = () => {
        if (selectLongPressRef.current !== null) {
            window.clearTimeout(selectLongPressRef.current);
            selectLongPressRef.current = null;
        }
    };
    const openSelectMenu = () => {
        clearSelectLongPress();
        setEyeOpen(false);
        setVOpen(false);
        setDrawMenuOpen(false);
        setSelectMenuOpen(true);
    };
    const onSelectPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse") return;
        clearSelectLongPress();
        selectLongFiredRef.current = false;
        selectLongPressRef.current = window.setTimeout(() => {
            selectLongFiredRef.current = true;
            openSelectMenu();
        }, 400);
    };
    const onSelectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        clearSelectLongPress();
        if (selectLongFiredRef.current) {
            e.preventDefault();
            selectLongFiredRef.current = false;
            return;
        }
        setSelectMenuOpen(false);
        dispatch(setToolMode("select"));
    };""", 1)
n += 1
print("✓ 加了 select 的长按/点击处理")

# ── ③ 「选择」按钮改造 ──────────────────────────────────────────────────────
old_sel = """            <BarButton
                label={t("mobile_select")}
                visual={s.toolModeGroup === "select" ? "solid" : "ghost"}
                active={s.toolModeGroup === "select"}
                onClick={() => dispatch(setToolMode("select"))}
            >
                <CursorArrowIcon width={16} height={16} />
            </BarButton>"""
assert t.count(old_sel) == 1, "选择按钮锚不唯一"
t = t.replace(old_sel, """            <BarButton
                label={t("mobile_select")}
                visual={s.toolModeGroup === "select" || s.toolModeGroup === "drag" ? "solid" : "ghost"}
                active={s.toolModeGroup === "select" || s.toolModeGroup === "drag"}
                onClick={onSelectClick}
            >
                {/* D4：加右下角标（与铅笔同款）；当前是「拖动」时图标换成手套 */}
                <span
                    data-hs-select-anchor
                    onPointerDown={onSelectPointerDown}
                    onPointerUp={clearSelectLongPress}
                    onPointerCancel={clearSelectLongPress}
                    onPointerLeave={clearSelectLongPress}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                    <IconCursorWithCorner drag={s.toolModeGroup === "drag"} />
                </span>
            </BarButton>""", 1)
n += 1
print("✓ 选择按钮：角标 + 手套形态")

# select 的 selector 要带上 toolModeGroup 已够用；补渲染菜单
old_render = "{drawMenuOpen ? <DrawToolMenu"
if old_render in t:
    idx = t.index(old_render)
    line_start = t.rfind("\n", 0, idx) + 1
    t = t[:line_start] + "            {selectMenuOpen ? (\n                <SelectToolMenu\n                    current={s.toolModeGroup}\n                    onPick={(mode) => dispatch(setToolMode(mode))}\n                    onClose={() => setSelectMenuOpen(false)}\n                />\n            ) : null}\n" + t[line_start:]
    n += 1
    print("✓ 渲染 SelectToolMenu")
else:
    print("  ⚠️ 没找到 DrawToolMenu 的渲染处，需手动挂")

MB.write_text(t, encoding="utf-8")

# ── ④ i18n ──────────────────────────────────────────────────────────────────
for f, vals in (("zh-CN.ts", ('选择', '拖动')), ("en-US.ts", ('Select', 'Drag'))):
    P = FE / "i18n" / f
    tt = P.read_text(encoding="utf-8")
    a = '    mobile_tool_menu: '
    assert tt.count(a) == 1, f"{f} 锚不唯一"
    tt = tt.replace(a, f'    mobile_tool_select: "{vals[0]}",\n    mobile_tool_drag: "{vals[1]}",\n' + a, 1)
    P.write_text(tt, encoding="utf-8")
    print(f"✓ {f}: mobile_tool_select / mobile_tool_drag")

print(f"\n共 {n} 处")
