#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组最后一条（轨道列）：**双指单击 = 单击非选中轨道**。

规格（flm 交互表，轨道列）：双指同时轻点一下 ⇒ 等价于"单击该轨道"。

## 为什么不改手势层

`touchGesture.ts`（`TwoFingerGestureController`）是**双指缩放/平移的核心**，
里面没有任何 tap 概念，且它被多个表面共用（拍数栏/轨道列/参数区）。
往里加 tap 判定 = 动核心状态机，风险与收益不成比例。

⇒ 改用**独立监听**：在时间线容器上自己数指针，**两指同时按下、
总移动都很小、且总时长很短** ⇒ 判定为双指 tap，按坐标切轨道。
只在 `pointerType !== "mouse"` 时生效（鼠标不受影响）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t = TP.read_text(encoding="utf-8")

old = """                const timelineContainer = host.getContainer();
                const onTrackDblClickPhone = () => {
                    if (window.innerWidth >= 600) return; // 只手机
                    dispatch(showMobilePanel("params"));
                };
                if (timelineContainer) {
                    timelineContainer.addEventListener("dblclick", onTrackDblClickPhone);
                    offs.push(() =>
                        timelineContainer.removeEventListener("dblclick", onTrackDblClickPhone),
                    );
                }"""

assert t.count(old) == 1, "容器双击锚不唯一"
t = t.replace(old, old + """

                /* E 组（轨道列）：**双指单击 = 单击非选中轨道**。
                   ⚠️ 不改 `touchGesture.ts`（那是双指缩放/平移的核心状态机，
                   且被多个表面共用）⇒ 这里用**独立监听**：两指同时按下、
                   都没怎么动、且总时长短 ⇒ 判定为双指 tap，按坐标切轨道。 */
                if (timelineContainer) {
                    const TAP_MS = 300;
                    const TAP_SLOP = 12;
                    let tapIds: number[] = [];
                    const tapStart = new Map<number, { x: number; y: number }>();
                    let tapAt = 0;
                    let tapFired = false;
                    const onTwoDown = (e: PointerEvent) => {
                        if (e.pointerType === "mouse") return;
                        if (tapIds.length === 0) tapAt = performance.now();
                        tapIds.push(e.pointerId);
                        tapStart.set(e.pointerId, { x: e.clientX, y: e.clientY });
                        tapFired = false;
                    };
                    const onTwoUp = (e: PointerEvent) => {
                        if (!tapIds.includes(e.pointerId)) return;
                        const st = tapStart.get(e.pointerId);
                        const moved =
                            st && (Math.abs(e.clientX - st.x) > TAP_SLOP ||
                                   Math.abs(e.clientY - st.y) > TAP_SLOP);
                        tapIds = tapIds.filter((id) => id !== e.pointerId);
                        tapStart.delete(e.pointerId);
                        if (moved) tapFired = true; // 有人动过 ⇒ 不算 tap
                        if (tapIds.length > 0 || tapFired) return;
                        // 双指都抬起且没人动过、总时长够短 ⇒ 双指 tap
                        if (performance.now() - tapAt > TAP_MS) return;
                        const trackId = resolveTrackIdAtClientY(e.clientY);
                        if (trackId) handleSelectTrack(trackId);
                    };
                    const onTwoCancel = (e: PointerEvent) => {
                        tapIds = tapIds.filter((id) => id !== e.pointerId);
                        tapStart.delete(e.pointerId);
                    };
                    timelineContainer.addEventListener("pointerdown", onTwoDown);
                    timelineContainer.addEventListener("pointerup", onTwoUp);
                    timelineContainer.addEventListener("pointercancel", onTwoCancel);
                    offs.push(() => {
                        timelineContainer.removeEventListener("pointerdown", onTwoDown);
                        timelineContainer.removeEventListener("pointerup", onTwoUp);
                        timelineContainer.removeEventListener("pointercancel", onTwoCancel);
                    });
                }""", 1)
print("✓ TimelinePanel：双指 tap ⇒ 切轨道")
TP.write_text(t, encoding="utf-8")

# 依赖检查
for name in ("resolveTrackIdAtClientY", "handleSelectTrack"):
    ok = (name in t)
    print(f"  依赖 {name}: {'有' if ok else '⚠️ 缺'}")
