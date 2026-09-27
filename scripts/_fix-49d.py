#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#49 收尾 2：`TrackList` 监听 `hs-rename-track` → 进入行内编辑态。

顶栏派发了事件，但 `TrackList` 得有人接。这里加一个 effect：
收到 `trackId` 就 `setEditingTrackId` + `setEditingName`，
并**滚到该轨**（否则长按之外的情况可能看不见它），再 `select()` 全选便于直接改。

⚠️ 复用同一个 `nameInputRef.current.select()` 手法 —— 长按菜单里就是这么写的
（`setTimeout(() => nameInputRef.current?.select(), 0)`）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TL = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "timeline" / "TrackList.tsx"
t = TL.read_text(encoding="utf-8")

old = """    // 自动修正菜单溢出屏幕
    useLayoutEffect(() => {
        const el = trackCtxMenuRef.current;"""

new = """    /* #49：顶栏「轨道」菜单的**重命名**项只能派事件（顶栏够不着这里的编辑态）
     * ⇒ 这里接住，进入行内编辑。滚到该轨再进编辑，避免"改的是看不见的那一条"。 */
    useEffect(() => {
        const onRename = (e: Event) => {
            const trackId = (e as CustomEvent<{ trackId?: string }>).detail?.trackId;
            if (!trackId) return;
            const target = tracks.find((tr) => tr.id === trackId);
            if (!target) return;
            // 选中它（与长按选中一致），再进入编辑。
            onSelectTrack?.(trackId);
            setEditingTrackId(trackId);
            setEditingName(target.name);
            setTimeout(() => nameInputRef.current?.select(), 0);
        };
        window.addEventListener("hs-rename-track", onRename);
        return () => window.removeEventListener("hs-rename-track", onRename);
    }, [tracks, onSelectTrack]);

    // 自动修正菜单溢出屏幕
    useLayoutEffect(() => {
        const el = trackCtxMenuRef.current;"""

assert t.count(old) == 1, f"锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
TL.write_text(t, encoding="utf-8")
print("✓ TrackList 已监听 hs-rename-track")

# 确认 tracks / onSelectTrack 这两个名字存在（否则 tsc 会报，但我先自检一次）
import re
for name in ("tracks", "onSelectTrack"):
    if not re.search(rf"\b{name}\b", t):
        print(f"  ⚠ 未找到 {name} —— tsc 会报，需要调整")
    else:
        print(f"  · {name} 存在")
