#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 第 3~4 步：PianoRollPanel 接上浮层（渲染 + 点空白关闭）。

浮层用 `createPortal` 挂到 `document.body` —— `PianoRollPanel` 的 return 结构很大，
用 portal 就不用动它，也不受祖先 `overflow: hidden` 影响（浮层要能贴到屏幕边缘）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "PianoRollPanel.tsx"
t = P.read_text(encoding="utf-8")

# ── ① import ────────────────────────────────────────────────────────────────
if "VibratoAdjustOverlay" not in t:
    a = 'import { usePianoRollInteractions'
    if t.count(a) == 1:
        t = t.replace(a, 'import { createPortal } from "react-dom";\n'
                          'import { VibratoAdjustOverlay, type VibratoAdjustInfo } from "./pianoRoll/VibratoAdjustOverlay";\n'
                       + a, 1)
        print("✓ import 已加（createPortal + VibratoAdjustOverlay）")
    else:
        # 退而求其次：挂在第一个 import 之后
        t = t.replace("import React", 'import { createPortal } from "react-dom";\n'
                                      'import { VibratoAdjustOverlay, type VibratoAdjustInfo } from "./pianoRoll/VibratoAdjustOverlay";\nimport React', 1)
        print("✓ import 已加（退化路径）")
else:
    print("· import 已存在")

# ── ② state + 点空白关闭 ────────────────────────────────────────────────────
a2 = "    const interactions = usePianoRollInteractions({"
assert t.count(a2) == 1, "hook 调用锚不唯一"
t = t.replace(a2, """    /**
     * #7：刚画完的颤音线 —— 非 null 时显示「波长/振幅」双滑条浮层。
     * `adjustRef` 由 hook 通过 `onVibratoAdjustReady` 注入（内部就是重算 + commitStroke）。
     */
    const [vibratoAdjust, setVibratoAdjust] = React.useState<VibratoAdjustInfo | null>(null);
    const vibratoAdjustFnRef = React.useRef<((p: { amplitude: number; frequency: number }) => void) | null>(
        null,
    );

    const closeVibratoAdjust = React.useCallback(() => setVibratoAdjust(null), []);

    /**
     * #7 第 4 步：**点空白处确认关闭**。
     *
     * 用户明确要求排除「拍数栏 / 钢琴栏 / 上下工具栏 / 菜单栏」——
     * 那些区域的点击各有各的语义（seek / 选音高 / 切工具 / 开菜单），
     * 不该被"关闭浮层"吃掉。所以判定是：
     *   命中浮层本身 ⇒ 不关；
     *   命中上面四类区域 ⇒ 不关；
     *   其余任何地方 ⇒ 关闭。
     */
    React.useEffect(() => {
        if (!vibratoAdjust) return;
        const KEEP_SELECTORS = [
            '[data-hs-vibrato-adjust="true"]', // 浮层自身
            '[data-hs-ruler]',                 // 拍数栏（时间线标尺）
            '[data-hs-piano-keys]',            // 钢琴栏
            '[data-hs-toolbar]',               // 上下工具栏
            '[role="menu"]',                   // 菜单栏与其下拉
            '[role="menubar"]',
            '[data-radix-popper-content-wrapper]',
        ].join(",");
        const onDown = (ev: Event) => {
            const el = ev.target as HTMLElement | null;
            if (!el || typeof el.closest !== "function") return;
            if (el.closest(KEEP_SELECTORS)) return;
            closeVibratoAdjust();
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [vibratoAdjust, closeVibratoAdjust]);

""" + a2, 1)
print("✓ state + 点空白关闭已加")

# ── ③ 传两个 prop（挂在 onCycleDragDirection 那一段之后）────────────────────
a3 = "        onCycleDragDirection: useCallback("
assert t.count(a3) == 1, "onCycleDragDirection 锚不唯一"
idx = t.index(a3)
# 找到该属性的收尾 ")," —— 向后匹配到下一个顶层 prop
seg_end = t.index("\n        on", idx + 10) if "\n        on" in t[idx + 10:] else None
inject_props = """        // #7：画完弹浮层 + 把"只改波形参数"的能力交给浮层
        onVibratoCommitted: setVibratoAdjust,
        onVibratoAdjustReady: useCallback((fn) => {
            vibratoAdjustFnRef.current = fn;
        }, []),
"""
t = t[:idx] + inject_props + t[idx:]
print("✓ 两个 prop 已传入 hook")

# ── ④ 渲染浮层（portal）────────────────────────────────────────────────────
# 找一个可靠的挂载点：在组件的 return 之后追加是做不到的，
# 改为在 hook 调用之后立刻放一个"渲染片段"——用 IIFE 包成 JSX 变量。
a4 = "    const interactions = usePianoRollInteractions({"
idx4 = t.index(a4)
# 找到这次 hook 调用结束（顶层 "    });"）
end4 = t.index("\n    });", idx4) + len("\n    });\n")
t = t[:end4] + """
    /** #7：浮层用 portal 挂到 body，避免受面板祖先的 overflow 裁剪。 */
    const vibratoAdjustOverlay = vibratoAdjust
        ? createPortal(
              <VibratoAdjustOverlay
                  info={vibratoAdjust}
                  onChange={(next) => {
                      vibratoAdjustFnRef.current?.(next);
                      // 浮层上的数值同步更新，拖动时读数才不会跳回旧值
                      setVibratoAdjust((prev) => (prev ? { ...prev, ...next } : prev));
                  }}
                  onClose={closeVibratoAdjust}
              />,
              document.body,
          )
        : null;
""" + t[end4:]
print("✓ 浮层 JSX 已生成（portal 到 body）")

P.write_text(t, encoding="utf-8")
print("\n⚠️ 还差：把 {vibratoAdjustOverlay} 插进组件的 return JSX 里")
