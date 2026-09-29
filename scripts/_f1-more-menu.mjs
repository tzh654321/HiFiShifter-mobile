#!/usr/bin/env node
/**
 * F1：临时菜单（浮条）的「更多」改为展开**右键会出现的那个菜单**（`ClipContextMenu`）。
 *
 * 为什么不把 `ClipContextMenu` 复制进浮条：它有 ~40 个 props（删除/静音/重命名/复制/
 * 切割/编组/规范化/反转/淡入淡出形状…），在浮条里重建等于把 TimelinePanel 那边的
 * 装配逻辑抄一遍 ⇒ 必然漂移。改法：浮条只**派发窗口事件**，
 * 由 TimelinePanel 里**已经装配好**的那个实例打开（与 `hs-open-settings` 同一手法）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ── ① TimelinePanel：监听事件 → 用当前选中块打开 ClipContextMenu ──────────
const tl = 'upstream-src/frontend/src/components/layout/TimelinePanel.tsx';
let t = readFileSync(tl, 'utf8');
if (!t.includes('hs-open-clip-context-menu')) {
    const anchor = '    const handleKernelSeekTo = React.useCallback(';
    const idx = t.indexOf(anchor);
    if (idx < 0) {
        console.log('⚠️ TimelinePanel 锚点未命中');
    } else {
        const block = `    /* F1（用户口径）：临时菜单（浮条）上的「更多」应当展开**右键会出现的那个菜单**
       （\`ClipContextMenu\`），而不是另做一个小菜单。浮条只派发事件，这里复用已装配好的
       那个实例 —— 它的 40 个 props（删除/静音/重命名/复制/切割/编组/规范化/反转…）
       都在下面统一装配，复制一份到浮条必然漂移。 */
    React.useEffect(() => {
        const onOpenClipMenu = (e: Event) => {
            const d = (e as CustomEvent<{ x?: number; y?: number }>).detail ?? {};
            const session = store.getState().session;
            const id = session.selectedClipId;
            if (!id) return;
            if (!session.clips.some((c) => c.id === id)) return;
            setTrackAreaMenu(null);
            setContextMenu({
                x: Math.round(d.x ?? window.innerWidth / 2),
                y: Math.round(d.y ?? window.innerHeight / 2),
                clipId: id,
            });
        };
        window.addEventListener("hs-open-clip-context-menu", onOpenClipMenu);
        return () => window.removeEventListener("hs-open-clip-context-menu", onOpenClipMenu);
    }, []);

`;
        t = t.slice(0, idx) + block + t.slice(idx);
        writeFileSync(tl, t, 'utf8');
        console.log('TimelinePanel: 事件监听已加');
    }
} else {
    console.log('TimelinePanel: 已有监听');
}

// ── ② ClipQuickActions：「更多」改为派发事件（位置用浮条当前坐标） ─────────
const qa = 'upstream-src/frontend/src/components/mobile/ClipQuickActions.tsx';
let q = readFileSync(qa, 'utf8');
q = q.replace(
    '{ key: "more", label: "更多", icon: <IconMore />, run: () => setMoreOpen((v) => !v) },',
    `{
                key: "more",
                label: "更多",
                icon: <IconMore />,
                /* F1：展开**右键那套菜单**（由 TimelinePanel 里的 ClipContextMenu 实例呈现），
                   不再另开一个小菜单。坐标用浮条自己的位置 —— 菜单会贴着浮条弹出，
                   与"从浮条点开"的直觉一致。 */
                run: () =>
                    window.dispatchEvent(
                        new CustomEvent("hs-open-clip-context-menu", {
                            detail: { x: barLeft, y: barTop },
                        }),
                    ),
            },`,
);
writeFileSync(qa, q, 'utf8');
console.log(`ClipQuickActions: 更多已改=${q.includes('hs-open-clip-context-menu')}`);
