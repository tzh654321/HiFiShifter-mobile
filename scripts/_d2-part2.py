#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D2 第二部分：笔菜单加「还原」项 + 图标 + i18n。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 图标：还原（回转箭头 + 擦除感）─────────────────────────────────────────
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")

ICON = '''
/**
 * D2：「还原」工具图标。
 *
 * 语义 = 电脑上**右键拖动参数**（把该段恢复成原始曲线），
 * 所以画成「向左回转的箭头 + 一段被抹平的线」——
 * 既表达"回到原样"，也不至于和普通的撤销箭头混淆。
 */
function IconRestoreTool({ width = 15, height = 15 }: { width?: number; height?: number }) {
    return (
        <svg width={width} height={height} viewBox="0 0 15 15" fill="none">
            {/* 回转箭头 */}
            <path
                d="M4.2 3.1C2.6 4.2 1.5 6 1.5 8.1C1.5 11.4 4.2 14 7.5 14C10.8 14 13.5 11.4 13.5 8.1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M1.3 6.2L2.5 3.2L5.4 4.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
            {/* 被抹平的一段（虚线 = 还原掉的内容） */}
            <path
                d="M5.2 8.1H9.8"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeDasharray="2 1.6"
            />
        </svg>
    );
}
'''

anchor = "function DrawToolMenu({"
assert t.count(anchor) == 1, "DrawToolMenu 锚不唯一"
t = t.replace(anchor, ICON.strip() + "\n\n" + anchor, 1)
print("✓ 加了 IconRestoreTool")

# ── ② DrawToolMenu：类型 + 行 ───────────────────────────────────────────────
t = t.replace('    onPick: (mode: "draw" | "vibrato") => void;',
              '    onPick: (mode: "draw" | "vibrato" | "restore") => void;', 1)
old_rows = '''    const rows: Array<{ mode: "draw" | "vibrato"; label: string; icon: React.ReactNode }> = [
        { mode: "draw", label: t("mobile_tool_draw"), icon: <Pencil1Icon width={15} height={15} /> },
        { mode: "vibrato", label: t("mobile_tool_vibrato"), icon: <IconVibrato /> },
    ];'''
assert t.count(old_rows) == 1, "rows 锚不唯一"
t = t.replace(old_rows, '''    const rows: Array<{
        mode: "draw" | "vibrato" | "restore";
        label: string;
        icon: React.ReactNode;
    }> = [
        { mode: "draw", label: t("mobile_tool_draw"), icon: <Pencil1Icon width={15} height={15} /> },
        { mode: "vibrato", label: t("mobile_tool_vibrato"), icon: <IconVibrato /> },
        /* D2：等价于电脑上右键拖动参数（手机上无右键/笔杆键，原本不可达） */
        { mode: "restore", label: t("mobile_tool_restore"), icon: <IconRestoreTool /> },
    ];''', 1)
print("✓ DrawToolMenu 加了「还原」行")
MB.write_text(t, encoding="utf-8")

# ── ③ i18n ──────────────────────────────────────────────────────────────────
for f, val in (("zh-CN.ts", "还原"), ("en-US.ts", "Restore")):
    P = FE / "i18n" / f
    t = P.read_text(encoding="utf-8")
    a = '    mobile_tool_menu: '
    assert t.count(a) == 1, f"{f} 锚不唯一"
    t = t.replace(a, f'    mobile_tool_restore: "{val}",\n' + a, 1)
    P.write_text(t, encoding="utf-8")
    print(f"✓ {f}: mobile_tool_restore = {val}")

# ── ④ 透视：onPick 的调用方是否需要放宽（setDrawToolMode 的入参类型）────────
print("\n⚠️ 提醒：`setDrawToolMode` 的 payload 类型是 `DrawToolMode`（已含 restore），无需改。")
