#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D4 后半：「拖动」工具的参数区单指平移。

用户口径：
> 新增工具“拖动”（手套图标），相比选择可以在参数区缩放、单指平移而不影响选区与参数，
> 只有单击拍数栏会改变进度条

⇒ 拖动工具下：
  · 参数区**单指拖 = 平移视野**（横向 + 纵向），**不碰选区、不改参数**
  · 拍数栏单击仍 seek（那是 `onRulerMouseDown` 的路径，与这里无关）
  · 双指缩放由手势层负责，本来就不经过这里

## 实现位置

放在 `onCanvasPointerDown` 的**最前面**、**在「按下即 seek」之前** ——
因为拖动工具连"点一下顺便 seek"都不该做（那是选择/绘制才有的附加行为）。
拖完直接 `return`，后面的选区/落笔/气泡分支一概不进。

## 为什么用原生 window 监听而不是 pointer capture

与同文件的 `onRulerMouseDown` 保持**同一模式**（它在 `move/up` 时挂 `window` 监听 + capture），
这样"手指划出画布"也能继续平移，且不必处理 capture 失败的各种边界。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "pianoRoll" / "usePianoRollInteractions.ts")
t = P.read_text(encoding="utf-8")

old = """    const onCanvasPointerDown = useCallback(
        (e: ReactPointerEvent<HTMLCanvasElement>) => {
            // 掌压拒识：笔 / 鼠标手势进行中时，触摸（书写时的手掌）按下不中止、
            // 不接管当前手势。pen / mouse 的第二指针维持原语义（切笔尖 / 橡皮
            // 是单手用户的正常路径）。"""

new = """    const onCanvasPointerDown = useCallback(
        (e: ReactPointerEvent<HTMLCanvasElement>) => {
            /**
             * D4：「拖动」工具 ⇒ 参数区**单指拖 = 平移视野**。
             *
             * 与「选择」的分工：选择能拉选区/改参数，拖动**只导航**（不动选区与参数）。
             * 放在最前面、拖完直接 return —— 连「按下即 seek」都不做（那是选择/绘制的附加行为）。
             * 拍数栏的单击 seek 走 `onRulerMouseDown`，与此无关，所以「只有单击拍数栏会改变进度条」成立。
             *
             * 用原生 window 监听（与 `onRulerMouseDown` 同一模式），
             * 这样手指划出画布也能继续平移。
             */
            if (toolMode === "drag" && e.button === 0) {
                const scroller = scrollerRef.current;
                if (!scroller) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const startLeft = scroller.scrollLeft;
                const startTop = scroller.scrollTop;
                const onMove = (ev: PointerEvent) => {
                    // 内容跟着手指走（位移取反），钳制交给渲染内核。
                    scroller.scrollLeft = startLeft - (ev.clientX - startX);
                    scroller.scrollTop = startTop - (ev.clientY - startY);
                    syncScrollLeft(scroller);
                };
                const onEnd = () => {
                    window.removeEventListener("pointermove", onMove, true);
                    window.removeEventListener("pointerup", onEnd, true);
                    window.removeEventListener("pointercancel", onEnd, true);
                };
                window.addEventListener("pointermove", onMove, true);
                window.addEventListener("pointerup", onEnd, true);
                window.addEventListener("pointercancel", onEnd, true);
                e.preventDefault();
                return;
            }

            // 掌压拒识：笔 / 鼠标手势进行中时，触摸（书写时的手掌）按下不中止、
            // 不接管当前手势。pen / mouse 的第二指针维持原语义（切笔尖 / 橡皮
            // 是单手用户的正常路径）。"""

assert t.count(old) == 1, "onCanvasPointerDown 锚不唯一"
t = t.replace(old, new, 1)
print("✓ onCanvasPointerDown：加了 drag 平移分支")

# 依赖数组补 scrollerRef / syncScrollLeft（若尚未包含）
import re
m = re.search(r"(\n        \)\s*;?\s*\n    \);\s*\n\s*\n\s*const onCanvasPointerMove)", t[max(0, t.index("const onCanvasPointerDown")):])
# 退化处理：直接找 onCanvasPointerDown 的依赖数组结尾
start = t.index("const onCanvasPointerDown")
seg = t[start:start + 16000]
dm = re.search(r"\n        \[\s*\n?([^\]]*?)\n?\s*\]\s*,\s*\n    \);", seg)
if dm:
    deps = dm.group(1)
    need = [d for d in ("scrollerRef", "syncScrollLeft") if d not in deps]
    if need:
        newdeps = deps.rstrip().rstrip(",") + ",\n        " + ",\n        ".join(need) + ",\n    "
        t = t[:start] + seg[:dm.start(1)] + newdeps + seg[dm.end(1):] + t[start + 16000:]
        print(f"  ✓ 依赖补：{need}")
    else:
        print("  · 依赖已含")
else:
    print("  ⚠️ 没找到依赖数组，需手动确认")

P.write_text(t, encoding="utf-8")
print("✓ 完成")
