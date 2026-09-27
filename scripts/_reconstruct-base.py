"""反向重建 0019 的基线（把本次改动从当前文件里撤掉），产出 /d/hs-base/<path>。
每个替换都断言命中次数，命中不为 1 就报错退出（宁可失败也不要产出错误基线）。"""
import re
import sys
from pathlib import Path

SRC = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\upstream-src")
OUT = Path(r"D:\hs-base")

FAILS = []


def read_cur(rel):
    """读「当前工作副本」：优先读上一轮写出的 OUT，保证多次替换是**累积**的。"""
    o = OUT / rel
    if o.exists():
        return o.read_text(encoding="utf-8")
    return (SRC / rel).read_text(encoding="utf-8")


def rev(rel, old, new, count=1):
    """把文件里的 new 换回 old（字面量，累积写入 OUT）。"""
    text = read_cur(rel)
    n = text.count(new)
    if n != count:
        FAILS.append(f"{rel}: 期望命中 {count} 次，实际 {n} 次 —— {new[:60]!r}")
        return
    text = text.replace(new, old)
    (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
    (OUT / rel).write_text(text, encoding="utf-8")


def rev_re(rel, old, pattern, count=1):
    text = read_cur(rel)
    m = list(re.finditer(pattern, text, re.S))
    if len(m) != count:
        FAILS.append(f"{rel}: 正则命中 {len(m)} 次（期望 {count}）—— {pattern[:70]}")
        return
    text = re.sub(pattern, lambda _m: old, text, count=count, flags=re.S)
    (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
    (OUT / rel).write_text(text, encoding="utf-8")


TG = "frontend/src/components/layout/touchGesture.ts"

rev(
    TG,
    """    private readonly pointers = new Map<number, ActivePointer>();
    private session: Session | null = null;""",
    """    private readonly pointers = new Map<number, ActivePointer>();
    /** 每个指针落在哪个「表面」上（用于 pointer capture / release）。 */
    private readonly pointerSurface = new Map<number, HTMLElement>();
    /** 额外注册的手势表面（拍数栏 / 琴键轴）：与 target 共用同一套状态机。 */
    private readonly surfaces = new Set<HTMLElement>();
    private readonly surfaceOffs = new Map<HTMLElement, () => void>();
    private session: Session | null = null;""",
)

rev_re(
    TG,
    """    attach(): void {
        if (this.attached) return;
        this.attached = true;
        // 接管双指手势：浏览器不得自行平移/缩放本容器（覆盖 body 的 pan-x pan-y）。
        this.target.style.touchAction = "none";
        this.target.addEventListener("pointerdown", this.onPointerDown, { passive: false });
        this.target.addEventListener("pointermove", this.onPointerMove, { passive: false });
        this.target.addEventListener("pointerup", this.onPointerUp);
        this.target.addEventListener("pointercancel", this.onPointerCancel);
        // 手势进行中屏蔽合成 wheel（双指捏合 → Ctrl+wheel），避免双重缩放（§6）。
        window.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
    }

    detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.target.style.touchAction = "";
        this.target.removeEventListener("pointerdown", this.onPointerDown);
        this.target.removeEventListener("pointermove", this.onPointerMove);
        this.target.removeEventListener("pointerup", this.onPointerUp);
        this.target.removeEventListener("pointercancel", this.onPointerCancel);
        window.removeEventListener("wheel", this.onWheel, { capture: true } as EventListenerOptions);
        this.pointers.clear();
        this.session = null;
        this.setActiveFlag(false);
    }

    private readonly onWheel""",
    r"    attach\(\): void \{.*?\n    private readonly onWheel",
)

rev_re(
    TG,
    """    private readonly onPointerDown = (e: PointerEvent): void => {
        if (e.pointerType === "mouse") return; // 鼠标走既有滚轮/拖拽，不接管
        // 1→2 过渡：先存在的单指拖拽必须干净中止（docs/08 §4.1）。
        if (this.pointers.size === 1) {
            for (const id of this.pointers.keys()) this.abortPointer(id);
        }
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            // 第二指落下才捕获指针（2026-09-19 修复）：单指期间绝不能 capture——
            // 捕获态会让 WebView 不合成原生 long-press → contextmenu，参数面板等
            // 把 onContextMenu 绑在内部元素上的菜单就再也弹不出来（时间线的菜单
            // 绑在容器层所以之前没暴露）。双指期间捕获把 move 锁到 target。
            for (const id of this.pointers.keys()) {
                try {
                    this.target.setPointerCapture(id);
                } catch {
                    /* 某些环境下 capture 可能失败，忽略即可 */
                }
            }
            e.preventDefault();
            e.stopPropagation();
            this.beginSession();
            this.setActiveFlag(true);
        }
    };

    private readonly onPointerMove""",
    r"    private readonly onPointerDown = \(e: PointerEvent\): void => \{.*?\n    private readonly onPointerMove",
)

rev_re(
    TG,
    """    private readonly onPointerMove = (e: PointerEvent): void => {
        if (e.pointerType === "mouse") return;
        const p = this.pointers.get(e.pointerId);
        if (p === undefined) return; // 冷却期/非手势指针：忽略
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size < 2) return; // 仍在冷却的单指：忽略
        e.preventDefault();
        if (this.now() < this.cooldownUntil) return; // 2→1 冷却期
        this.update();
    };

    private readonly onPointerUp""",
    r"    private readonly onPointerMove = \(e: PointerEvent\): void => \{.*?\n    private readonly onPointerUp",
)

rev(
    TG,
    """        try {
            this.target.releasePointerCapture(id);
        } catch {
            /* ignore */
        }""",
    """        try {
            this.pointerSurface.get(id)?.releasePointerCapture(id);
        } catch {
            /* ignore */
        }
        this.pointerSurface.delete(id);""",
)

# ── PianoRollPanel ────────────────────────────────────────────────────────
PR = "frontend/src/components/layout/PianoRollPanel.tsx"

rev_re(
    PR,
    "        setScrollLeft(next);\n    }, [pxPerSec, s.paramEditorSyncTimeline]);",
    r"        setScrollLeft\(next\);.*?\n    \}, \[pxPerSec, scrollLeft, s\.paramEditorSyncTimeline\]\);",
)

rev_re(
    PR,
    """            const valueToRow = () => {
                const h = vh();
                const view = getCurrentViewportForScrollbar(editParamRef.current);
                const rowHeight = h / Math.max(1e-6, view.span);
                return { rowHeight, scrollTop: view.center * rowHeight - h / 2 };
            };""",
    r"            // 【值域轴是反向的】.*?\n            \};",
)

rev(
    PR,
    "                    const center = (scrollTop + h / 2) / rowHeight;",
    """                    // 与 valueToRow 同一约定：center = -scrollTop / rowHeight。
                    const center = -scrollTop / Math.max(1e-9, rowHeight);""",
)

rev_re(
    PR,
    "        };\n        tryAttach();",
    r"            // 调试钩子（与时间线的.*?\n        \};\n        tryAttach\(\);",
)

rev(
    PR,
    "",
    """            delete (window as unknown as { __hsParamViewport?: () => unknown })
                .__hsParamViewport;
""",
)

rev_re(
    PR,
    r"""    // ── 琴键轴 / 拍数栏手势（用户要求）：单指=平移，双指=该轴缩放 ─────────────
    // 琴键轴（axisWrap，纵向）：单指拖 → center 平移；双指捏合 → span 缩放（中点锚定）。
    // 拍数栏（rulerContent，横向）：单指拖 → scrollLeft 平移；双指捏合 → pxPerSec。
    // 横向都走 handleHorizontalZoom（含同步/钳制），纵向走 syncVerticalScrollbarForViewport。
    // 这两块区域无子交互（点击跳播放头 = tap 无位移，不受拖动影响），可整体
    // touch-action:none。
    const axisGesturesRef = useRef<Array<() => void>>([]);

    useEffect(() => {
        if (!IS_ANDROID) return;
        let cancelled = false;
        const tryAttach = () => {
            if (cancelled) return;
            const axisEl = axisWrapRef.current;
            const rulerEl = rulerContentRef.current;
            if (!axisEl || !rulerEl) {
                requestAnimationFrame(tryAttach);
                return;
            }
            const vh = () => Math.max(1, scrollerRef.current?.clientHeight ?? 1);
            const currentRow = () => {
                const h = vh();
                const view = getCurrentViewportForScrollbar(editParamRef.current);
                const rowHeight = h / Math.max(1e-6, view.span);
                return {
                    rowHeight,
                    scrollTop: view.center * rowHeight - h / 2,
                    span: view.span,
                    center: view.center,
                };
            };
            const attach = (el: HTMLElement, axis: "x" | "y"): (() => void) => {
                el.style.touchAction = "none";
                const pointers = new Map<number, { x: number; y: number }>();
                // 单指平移基准
                let pan:
                    | { x0: number; y0: number; sl0: number; center0: number; span0: number; rowH0: number }
                    | null = null;
                // 双指捏合基准
                let two:
                    | { mid0: number; sp0: number; pps0: number; sec0: number; rowH0: number; rowAtMid0: number }
                    | null = null;
                const onDown = (e: PointerEvent) => {
                    if (e.pointerType === "mouse") return;
                    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    try {
                        el.setPointerCapture(e.pointerId);
                    } catch {
                        /* ignore */
                    }
                    if (pointers.size === 1) {
                        if (axis === "x") {
                            pan = { x0: e.clientX, y0: e.clientY, sl0: scrollLeftRef.current, center0: 0, span0: 1, rowH0: 1 };
                        } else {
                            const row = currentRow();
                            pan = { x0: e.clientX, y0: e.clientY, sl0: 0, center0: row.center, span0: row.span, rowH0: row.rowHeight };
                        }
                        two = null;
                    } else if (pointers.size === 2) {
                        pan = null;
                        const pts = [...pointers.values()];
                        const sp = (axis === "x" ? Math.abs(pts[0].x - pts[1].x) : Math.abs(pts[0].y - pts[1].y)) || 1;
                        const mid = axis === "x" ? (pts[0].x + pts[1].x) / 2 : (pts[0].y + pts[1].y) / 2;
                        if (axis === "x") {
                            const pps0 = pxPerSecRef.current || 1;
                            two = { mid0: mid, sp0: sp, pps0, sec0: (scrollLeftRef.current + mid) / pps0, rowH0: 1, rowAtMid0: 0 };
                        } else {
                            const row = currentRow();
                            two = {
                                mid0: mid,
                                sp0: sp,
                                pps0: 1,
                                sec0: 0,
                                rowH0: row.rowHeight,
                                rowAtMid0: (row.scrollTop + mid) / row.rowHeight,
                            };
                        }
                    }
                };
                const onMove = (e: PointerEvent) => {
                    const p = pointers.get(e.pointerId);
                    if (!p) return;
                    p.x = e.clientX;
                    p.y = e.clientY;
                    if (pointers.size >= 2 && two) {
                        const pts = [...pointers.values()];
                        const sp = (axis === "x" ? Math.abs(pts[0].x - pts[1].x) : Math.abs(pts[0].y - pts[1].y)) || 1;
                        const mid = axis === "x" ? (pts[0].x + pts[1].x) / 2 : (pts[0].y + pts[1].y) / 2;
                        const k = sp / two.sp0;
                        if (axis === "x") {
                            const pps = Math.min(8000, Math.max(10, two.pps0 * k));
                            horizontalZoomRef.current(pps, two.sec0 * pps - mid);
                        } else {
                            const h = vh();
                            const newRowH = Math.min(1e6, Math.max(0.2, two.rowH0 * k));
                            const span = h / newRowH;
                            const scrollTop = two.rowAtMid0 * newRowH - mid;
                            syncVerticalScrollbarForViewport(editParamRef.current, {
                                center: (scrollTop + h / 2) / newRowH,
                                span,
                            });
                        }
                    } else if (pointers.size === 1 && pan) {
                        if (axis === "x") {
                            horizontalZoomRef.current(pxPerSecRef.current, pan.sl0 + (e.clientX - pan.x0));
                        } else {
                            const center = pan.center0 + (pan.y0 - e.clientY) / pan.rowH0;
                            syncVerticalScrollbarForViewport(editParamRef.current, {
                                center,
                                span: pan.span0,
                            });
                        }
                    }
                };
                const onUp = (e: PointerEvent) => {
                    pointers.delete(e.pointerId);
                    if (pointers.size < 2) two = null;
                    if (pointers.size < 1) pan = null;
                };
                el.addEventListener("pointerdown", onDown);
                el.addEventListener("pointermove", onMove);
                el.addEventListener("pointerup", onUp);
                el.addEventListener("pointercancel", onUp);
                return () => {
                    el.removeEventListener("pointerdown", onDown);
                    el.removeEventListener("pointermove", onMove);
                    el.removeEventListener("pointerup", onUp);
                    el.removeEventListener("pointercancel", onUp);
                };
            };
            const offY = attach(axisEl, "y");
            const offX = attach(rulerEl, "x");
            axisGesturesRef.current = [offY, offX];
        };
        tryAttach();
        return () => {
            cancelled = true;
            for (const off of axisGesturesRef.current) off();
            axisGesturesRef.current = [];
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);""",
    r"    // ── 琴键轴 / 拍数栏手势（用户要求）：单指=平移，双指=缩放 ─────────────────.*?\n    \}, \[\]\);",
)

rev(
    PR,
    """                            className="absolute right-0 top-0 bottom-0 w-2 z-20\"""",
    """                            className="hs-sb hs-sb-v absolute right-0 top-0 bottom-0 w-2 z-20\"""",
)
rev(
    PR,
    """                                className="absolute left-0 w-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
    """                                className="hs-sb-thumb absolute left-0 w-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
)
rev(
    PR,
    """                            className="absolute bottom-0 left-0 right-0 h-2 z-20\"""",
    """                            className="hs-sb hs-sb-h absolute bottom-0 left-0 right-0 h-2 z-20\"""",
)
rev(
    PR,
    """                                className="absolute top-0 h-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
    """                                className="hs-sb-thumb absolute top-0 h-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
)

# ── TimelineKernelView ───────────────────────────────────────────────────
TKV = "frontend/src/components/layout/timeline/kernel/TimelineKernelView.tsx"
rev(
    TKV,
    """            <div ref={vTrackRef} className="absolute right-0 top-0 bottom-0 z-20 w-2">""",
    """            <div ref={vTrackRef} className="hs-sb hs-sb-v absolute right-0 top-0 bottom-0 z-20 w-2">""",
)
rev(
    TKV,
    """                    className="absolute left-0 w-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
    """                    className="hs-sb-thumb absolute left-0 w-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
)
rev(
    TKV,
    """            <div ref={hTrackRef} className="absolute bottom-0 left-0 right-0 z-20 h-2">""",
    """            <div ref={hTrackRef} className="hs-sb hs-sb-h absolute bottom-0 left-0 right-0 z-20 h-2">""",
)
rev(
    TKV,
    """                    className="absolute top-0 h-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
    """                    className="hs-sb-thumb absolute top-0 h-full rounded-full bg-[var(--qt-scrollbar-thumb)]\"""",
)

# ── index.css ────────────────────────────────────────────────────────────
CSS = "frontend/src/index.css"
rev_re(
    CSS,
    "",
    r"/\* ── 自绘滚动条 / 滑条：触屏拖拽的两条硬要求.*?\.qt-range \{\n    touch-action: none;\n\}\n\n",
)

rev(
    CSS,
    "",
    """    /* 滚动条命中区外扩（视觉不变）：横条向上长 12px 进内容区、竖条向左长 12px。 */
    .hs-sb-v {
        width: 20px !important;
    }
    .hs-sb-v .hs-sb-thumb {
        width: 8px !important;
        left: 6px !important;
    }
    .hs-sb-h {
        height: 20px !important;
    }
    .hs-sb-h .hs-sb-thumb {
        height: 8px !important;
        top: 6px !important;
    }
""",
)

rev(
    CSS,
    """.hs-icon-btn:active {
    filter: brightness(0.88);
}""",
    """.hs-icon-btn:active {
    filter: brightness(0.88);
}

/* 底栏按钮（MobileBottomBar）：命中区 40px、视觉 28px 的「内盒子」，
   按压效果作用在内盒子上（与原版 IconButton 的按压变暗一致）。 */
.hs-bar-btn:active .hs-bar-vis {
    filter: brightness(0.88);
}""",
)

if FAILS:
    print("❌ 反向重建失败：")
    for f in FAILS:
        print("  " + f)
    sys.exit(1)
print("✅ 基线重建完成 →", OUT)
for p in sorted(OUT.rglob("*")):
    if p.is_file():
        print("   ", p.relative_to(OUT), p.stat().st_size, "bytes")
