#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 收尾：把选区编辑的 5 个 op 接到**手机工具栏**上。

## 为什么桌面那版在手机上不可见

`.hs-param-toolbar` 在手机上 `display: none`（`index.css`，手机改用自绘的
`MobileParamToolRow`）。所以我把按钮加进桌面工具栏后，CDP 能查到 5 个按钮存在、
`aria-label` 也对，但 `getBoundingClientRect()` 全是 0 —— 整个祖先被隐藏了。

## 通道选择

`PianoRollPanel` 已有 `handleEditOp(op, data)`（L5154，内含 copy/cut/paste/
shiftParamUpSelection/shiftParamDownSelection 等全部 op），
并且有个 `handleEditActionRef` + `stableEditAction` 的"稳定回调节"模式 ——
说明上游也需要"从外部触发编辑 op"。

这里用**最小侵入**的做法：在 `PianoRollPanel` 里把这个稳定回调挂到 window 上
（`__hsEditOp`），`MobileParamToolRow` 直接调它。
不引入 Context / props 穿透，因为它俩分属不同组件树（底栏 vs 参数面板）。

⚠️ 挂 window 只是过渡方案；若以后要接更多 op，应该改成 Context。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① PianoRollPanel：把稳定回调暴露到 window ────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

anchor = """    // Stable callback that delegates to the latest handleEditOp via ref
    const stableEditAction = useCallback((op: string) => {
        handleEditActionRef.current(op);
    }, []);"""
assert t.count(anchor) == 1, "stableEditAction 锚不唯一"
t = t.replace(anchor, anchor + """

    /**
     * D1：把选区编辑 op 暴露给**手机工具栏**（`MobileParamToolRow`）。
     *
     * 底栏与参数面板是两棵组件树，而 `.hs-param-toolbar` 在手机上 `display:none`
     * （手机用自绘的 `MobileParamToolRow`）⇒ 桌面工具栏里加的按钮在手机上不可见。
     * 这里挂一个 window 出口，底栏直接调用。
     *
     * ⚠️ 过渡方案：op 少（5 个）且语义稳定时够用；若要继续扩展应改成 Context。
     */
    useEffect(() => {
        const w = window as unknown as { __hsEditOp?: (op: string) => void };
        w.__hsEditOp = stableEditAction;
        return () => {
            if (w.__hsEditOp === stableEditAction) delete w.__hsEditOp;
        };
    }, [stableEditAction]);""", 1)
PP.write_text(t, encoding="utf-8")
print("✓ PianoRollPanel：__hsEditOp 已暴露")

# ── ② MobileParamToolRow：加 5 个按钮 ───────────────────────────────────────
MB = FE / "components" / "mobile" / "MobileBottomBar.tsx"
t = MB.read_text(encoding="utf-8")

# 找「参数菜单」按钮的位置，把组插在它之前
anchor2 = """            {/* ∨ 参数菜单（新增）：竖排面板 = 参数工具行整块重排 */}"""
assert t.count(anchor2) == 1, "参数菜单注释锚不唯一"
GROUP = """            {/* D1：选区编辑（复制/剪切/粘贴/上移/下移）。
                ⚠️ 这些 op 的业务逻辑都在 `PianoRollPanel.handleEditOp` 里，
                通过 `window.__hsEditOp` 桥接过来（底栏与参数面板是两棵组件树）。 */}
            <BarButton
                label={t("ctx_copy")}
                visual="ghost"
                onClick={() => (window as unknown as { __hsEditOp?: (op: string) => void }).__hsEditOp?.("copy")}
            >
                <CopyIcon width={16} height={16} />
            </BarButton>
            <BarButton
                label={t("ctx_cut")}
                visual="ghost"
                onClick={() => (window as unknown as { __hsEditOp?: (op: string) => void }).__hsEditOp?.("cut")}
            >
                <IconScissors />
            </BarButton>
            <BarButton
                label={t("ctx_paste")}
                visual="ghost"
                onClick={() => (window as unknown as { __hsEditOp?: (op: string) => void }).__hsEditOp?.("paste")}
            >
                <ClipboardIcon width={16} height={16} />
            </BarButton>
            <BarButton
                label={t("kb_pianoroll_shift_param_up_selection")}
                visual="ghost"
                onClick={() =>
                    (window as unknown as { __hsEditOp?: (op: string) => void }).__hsEditOp?.(
                        "shiftParamUpSelection",
                    )
                }
            >
                <PlusIcon width={16} height={16} />
            </BarButton>
            <BarButton
                label={t("kb_pianoroll_shift_param_down_selection")}
                visual="ghost"
                onClick={() =>
                    (window as unknown as { __hsEditOp?: (op: string) => void }).__hsEditOp?.(
                        "shiftParamDownSelection",
                    )
                }
            >
                <MinusIcon width={16} height={16} />
            </BarButton>

"""
t = t.replace(anchor2, GROUP + anchor2, 1)
print("✓ MobileParamToolRow：加了 5 个按钮")

# 图标 import（若缺）
if "CopyIcon" not in t.split("export function")[0]:
    import re
    m = re.search(r"^import \{([^}]*)\} from \"@radix-ui/react-icons\";", t, re.M)
    if m:
        have = m.group(1)
        need = [x for x in ("CopyIcon", "ClipboardIcon", "PlusIcon", "MinusIcon") if x not in have]
        if need:
            t = t[:m.start()] + f'import {{{have.rstrip()}, {", ".join(need)} }} from "@radix-ui/react-icons";' + t[m.end():]
            print(f"  ✓ 补图标 import: {need}")
    else:
        print("  ⚠️ 没找到 icons import")

# 剪刀图标（手机侧另画一份，保持与桌面一致的造型）
if "function IconScissors" not in t:
    SC = '''
/** D1：剪切图标（Radix 无剪刀，造型与桌面工具栏那份保持一致）。 */
function IconScissors({ width = 16, height = 16 }: { width?: number; height?: number }) {
    return (
        <svg width={width} height={height} viewBox="0 0 15 15" fill="none">
            <circle cx="4" cy="11.2" r="2.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <circle cx="11.5" cy="11.2" r="2.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M5.5 9.6L11.2 1.6M9.9 9.6L4.2 1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}
'''
    a2 = "/** 绘制工具子菜单（点铅笔右下角三角 / 长按铅笔打开）。 */"
    assert t.count(a2) == 1
    t = t.replace(a2, SC.strip() + "\n\n" + a2, 1)
    print("  ✓ 加了 IconScissors")

MB.write_text(t, encoding="utf-8")
print("✓ 完成")
