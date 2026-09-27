#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B4 衔接修复：切页后由 App 接管拖拽指针跟踪。

## 问题

`useTimelineDragDrop.onHifiFileDrag` 是**被动接收方** —— 它只处理
`FileBrowserPanel` 派发来的 `start / move / duration` 事件，自己不挂 pointer 监听。

⇒ 一旦"拖到边缘切页"，`FileBrowserPanel` 被卸载 ⇒ **没人再派发 move**
⇒ 拖拽停在中途，松手时轨道窗收不到落点。

## 解法：切页后由 App 接管

App 在派发 `hs-mobile-switch-tab` 的那一刻就知道"要过页了"，
此时挂上 window 的 `pointermove / pointerup`，**替文件面板继续派发 `hifi-file-drag`**
（`move` 与 `drop`），直到抬手。

⚠️ 需要文件名/时长等上下文 ⇒ 从文件面板派发的 `start` 事件里**截存一份**。
   这里用 window 上的一个共享槽位 `__hsDragPayload` 传递（文件面板派发 start 时写入）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① App.tsx：切页时接管 ───────────────────────────────────────────────────
APP = FE / "App.tsx"
t = APP.read_text(encoding="utf-8")
old = """    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobileTab }>).detail?.tab;
            if (tab) setMobileTab(tab);
        };
        window.addEventListener("hs-mobile-switch-tab", onSwitch);
        return () => window.removeEventListener("hs-mobile-switch-tab", onSwitch);
    }, []);"""
assert t.count(old) == 1, "切页监听锚不唯一"
t = t.replace(old, """    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobileTab }>).detail?.tab;
            if (tab) {
                setMobileTab(tab);
                /* B4：切页会卸载文件面板 ⇒ 由 App **接管后续 pointer 跟踪**，
                   替它继续派发 `hifi-file-drag`（move / drop），否则拖拽断在中途。
                   上下文（文件名、路径、时长）由文件面板在 start 时写进 window 槽位。 */
                if (tab !== "files") beginDragTakeover();
            }
        };
        window.addEventListener("hs-mobile-switch-tab", onSwitch);
        return () => window.removeEventListener("hs-mobile-switch-tab", onSwitch);

        function beginDragTakeover() {
            type Payload = {
                filePath: string;
                fileName: string;
                filePaths: string[];
                durationSec?: number;
            };
            const read = (): Payload | null =>
                (window as unknown as { __hsDragPayload?: Payload }).__hsDragPayload ?? null;

            const emit = (type: string, x: number, y: number) => {
                const p = read();
                if (!p) return;
                window.dispatchEvent(
                    new CustomEvent("hifi-file-drag", {
                        detail: {
                            type,
                            filePath: p.filePath,
                            fileName: p.fileName,
                            filePaths: p.filePaths,
                            durationSec: p.durationSec ?? 0,
                            clientX: x,
                            clientY: y,
                            isRightDrag: false,
                        },
                    }),
                );
            };
            const onMove = (ev: PointerEvent) => emit("move", ev.clientX, ev.clientY);
            const onUp = (ev: PointerEvent) => {
                emit("drop", ev.clientX, ev.clientY);
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                delete (window as unknown as { __hsDragPayload?: Payload }).__hsDragPayload;
            };
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
        }
    }, []);""", 1)
APP.write_text(t, encoding="utf-8")
print("✓ App.tsx：切页时接管拖拽指针跟踪")

# ── ② FileBrowserPanel：start 时把上下文写进 window 槽位 ─────────────────────
FB = FE / "components" / "layout" / "FileBrowserPanel.tsx"
t = FB.read_text(encoding="utf-8")
anchor = """                // 激活拖拽
                dragStateRef.current = { ...ds, active: true };"""
assert t.count(anchor) == 1, "激活锚不唯一"
t = t.replace(anchor, anchor + """

                /* B4：把拖拽上下文交给 window —— 若中途切页（文件面板被卸载），
                   App 要用它继续派发 move / drop。 */
                (window as unknown as { __hsDragPayload?: unknown }).__hsDragPayload = {
                    filePath: ds.filePath,
                    fileName: ds.fileName,
                    filePaths: ds.allFilePaths,
                    durationSec: 0,
                };""", 1)
FB.write_text(t, encoding="utf-8")
print("✓ FileBrowserPanel：start 时写入 __hsDragPayload")
