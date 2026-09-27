#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4：文件浏览器长按拖动音频到轨道窗（**手机版**）。

## 先说结论：拖放链路**本来就存在**，缺的是"手机上过不去"

完整链路（读代码确认）：

```
FileBrowserPanel.handlePointerDownForDrag          ← 起拖（阈值 DRAG_THRESHOLD）
  └─ window.dispatchEvent(new CustomEvent("hifi-file-drag"))
       └─ useTimelineDragDrop.ts:567   window.addEventListener("hifi-file-drag", onHifiFileDrag)
       └─ PianoRollPanel.tsx:1087      window.addEventListener("hifi-file-drag", onHifiFileDrag)
            └─ importAudioAtPosition / importMultipleAudioAtPosition
```

⇒ 桌面拖放是能用的。

## 🔴 真正的障碍：手机是**单面板**

`App.tsx:3991` —— 手机（`isPhone`）用 `BottomTabs` 在
`轨道 / 参数 / 文件 / 笔记` 之间**互斥切换**（`mobileTab` 是 App 的局部 state）。
文件页显示时，**轨道页根本没渲染** ⇒ 指针再怎么拖也落不到轨道容器上。

## 解法：拖到屏幕边缘 ⇒ 自动切到轨道页

这是单面板应用的标准做法（拖到边缘 → 页面自动翻）。
实现分两处：

1. `App.tsx`：监听 `window` 的 `hs-mobile-switch-tab` 事件 ⇒ `setMobileTab(...)`。
   （`mobileTab` 是局部 state，外部组件够不着，所以走 window 事件桥。）
2. `FileBrowserPanel`：拖拽进行中，指针停在**左右边缘**（各 56px 内）超过 400ms
   ⇒ 派发该事件切页。

⚠️ 加 400ms 停留判定是为了**避免误触**（手指划过边缘不该切页）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① App.tsx：监听切页事件 ─────────────────────────────────────────────────
APP = FE / "App.tsx"
t = APP.read_text(encoding="utf-8")
old = '    const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");'
assert t.count(old) == 1, "mobileTab 锚不唯一"
t = t.replace(old, old + """

    /**
     * B4：手机端**单面板**下，文件浏览器的拖拽要能落到轨道页。
     *
     * `mobileTab` 是本组件的局部 state，`FileBrowserPanel` 够不着，
     * 所以走 window 事件桥：拖拽中指针停在屏幕左右边缘时由文件面板派发，
     * 这里负责真的切页。
     */
    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobileTab }>).detail?.tab;
            if (tab) setMobileTab(tab);
        };
        window.addEventListener("hs-mobile-switch-tab", onSwitch);
        return () => window.removeEventListener("hs-mobile-switch-tab", onSwitch);
    }, []);""", 1)
APP.write_text(t, encoding="utf-8")
print("✓ App.tsx：监听 hs-mobile-switch-tab")

# ── ② FileBrowserPanel：拖到边缘 ⇒ 切页 ─────────────────────────────────────
FB = FE / "components" / "layout" / "FileBrowserPanel.tsx"
t = FB.read_text(encoding="utf-8")

anchor = """                if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
                // 激活拖拽
                dragStateRef.current = { ...ds, active: true };"""
assert t.count(anchor) == 1, "拖拽激活锚不唯一"
t = t.replace(anchor, anchor, 1)

# 在 onPointerMove 里加边缘检测（挂在"已激活"之后）
old_move = """        function onPointerMove(e: PointerEvent) {
            const ds = dragStateRef.current;
            if (!ds) return;
"""
assert t.count(old_move) == 1, "onPointerMove 锚不唯一"
t = t.replace(old_move, """        function onPointerMove(e: PointerEvent) {
            const ds = dragStateRef.current;
            if (!ds) return;

            /* B4：**拖到屏幕左右边缘 ⇒ 自动切到轨道页**。
               手机是单面板（文件页显示时轨道页没渲染），不切页就永远拖不过去。
               加 400ms 停留判定避免手指划过边缘时误切。 */
            if (ds.active) {
                const EDGE = 56;
                const w = window.innerWidth;
                const near = e.clientX <= EDGE ? "left" : e.clientX >= w - EDGE ? "right" : null;
                const st = edgeSwitchRef.current;
                if (near) {
                    if (st.side !== near) {
                        if (st.timer !== null) window.clearTimeout(st.timer);
                        st.side = near;
                        st.timer = window.setTimeout(() => {
                            window.dispatchEvent(
                                new CustomEvent("hs-mobile-switch-tab", {
                                    detail: { tab: "timeline" },
                                }),
                            );
                            st.timer = null;
                        }, 400);
                    }
                } else if (st.timer !== null) {
                    window.clearTimeout(st.timer);
                    st.timer = null;
                    st.side = null;
                }
            }
""", 1)

# 声明的 ref
old_eff = """    useEffect(() => {
        if (!dragState) return;
"""
assert t.count(old_eff) == 1, "effect 锚不唯一"
t = t.replace(old_eff, """    /** B4：边缘切页的停留计时（避免误触）。 */
    const edgeSwitchRef = useRef<{ side: "left" | "right" | null; timer: number | null }>({
        side: null,
        timer: null,
    });

    useEffect(() => {
        if (!dragState) return;
""", 1)

FB.write_text(t, encoding="utf-8")
print("✓ FileBrowserPanel：拖到边缘 ⇒ 派发切页事件")
