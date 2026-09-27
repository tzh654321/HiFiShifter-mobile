#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""② 接线：**双指长按 ⇒ 点亮 alt**（于是拖块 = slip）。

与已有的"双指 tap ⇒ 切轨道"共用同一套指针计数（`tapIds`），
只是多了个 500ms 定时器：两指按住不动满 500ms ⇒ `setTouchModifiers({alt:true})`，
任一指针抬起/移动过量 ⇒ `clearTouchModifiers()`。

⚠️ **必须在拖拽开始之前点亮** —— `dragModifiersOf` 是在 **pointerdown** 时快照的
（内核注释原话：「收尾时才读事件早就没有修饰键状态了」）。
所以顺序是：**两指按住 500ms（点亮）→ 再动手指拖块（slip 生效）**，
正好对上规格的「**双指长按并划动**」。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TP = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                    const onTwoDown = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length === 0) tapAt = performance.now();
                        tapIds.push(e.pointerId);
                        tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        tapFired = false;
                    };"""
assert t.count(old) == 1, "onTwoDown 锚不唯一"
t = t.replace(old, """                    /* E 组（最后一格）：**双指长按并划动 = slip（调整音频相对块位置）**。
                       触屏没有 Alt，而内核的 slip/copy/免吸附全靠修饰键
                       （`dragModifiersOf`）⇒ 这里在两指按住满 500ms 时
                       点亮"虚拟 Alt"，抬手清掉。 */
                    let twoTimer: number | null = null;
                    const clearTwoTimer = () => {
                        if (twoTimer !== null) {
                            window.clearTimeout(twoTimer);
                            twoTimer = null;
                        }
                    };
                    const onTwoDown = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length === 0) tapAt = performance.now();
                        tapIds.push(e.pointerId);
                        tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        tapFired = false;
                        // 两指都按下后才启动长按计时（单指不算）。
                        if (tapIds.length === 2 && twoTimer === null) {
                            twoTimer = window.setTimeout(() => {
                                setTouchModifiers({ alt: true });
                            }, 500);
                        }
                    };""", 1)
print("✓ onTwoDown：加双指长按计时")

# 抬手 / 取消：清定时器 + 清虚拟修饰键
old_up = """                    const onTwoUp = (e: PointerEvent) => {
                        if (!tapIds.includes(e.pointerId)) return;"""
assert t.count(old_up) == 1, "onTwoUp 锚不唯一"
t = t.replace(old_up, """                    const onTwoUp = (e: PointerEvent) => {
                        if (!tapIds.includes(e.pointerId)) return;
                        clearTwoTimer();
                        clearTouchModifiers();""", 1)
print("✓ onTwoUp：清定时器 + 清虚拟修饰键")

old_cancel = """                    const onTwoCancel = (e: PointerEvent) => {
                        tapIds = tapIds.filter((id) => id !== e.pointerId);
                        tapStart.delete(e.pointerId);
                    };"""
assert t.count(old_cancel) == 1, "onTwoCancel 锚不唯一"
t = t.replace(old_cancel, """                    const onTwoCancel = (e: PointerEvent) => {
                        tapIds = tapIds.filter((id) => id !== e.pointerId);
                        tapStart.delete(e.pointerId);
                        clearTwoTimer();
                        clearTouchModifiers();
                    };""", 1)
print("✓ onTwoCancel：同上")

# import setTouchModifiers / clearTouchModifiers
if "setTouchModifiers" not in t.split("export function TimelinePanel")[0]:
    anchor = "import { resolveClipDoubleClickMode }"
    # 退化为在第一个 import 后插
    import re
    m = re.search(r'^import \{([^}]*)\} from "\.\./\.\./components/layout/timeline/kernel/host/timelineKernelHost";', t, re.M)
    if not m:
        m = re.search(r'^import .*timelineKernelHost";', t, re.M)
    if m:
        t = t[:m.end()] + ('\nimport {\n    setTouchModifiers,\n    clearTouchModifiers,\n}'
                           ' from "./timeline/kernel/host/timelineKernelHost";') + t[m.end():]
        print("✓ import setTouchModifiers / clearTouchModifiers")
    else:
        print("  ⚠️ 找不到 kernel host 的 import，需人工确认")

TP.write_text(t, encoding="utf-8")
print("✓ 完成")
