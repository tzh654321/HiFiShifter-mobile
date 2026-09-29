#!/usr/bin/env node
/**
 * E5 接线 + G-1 加日志：
 *   ① ClipControlPoints 换成"块外圆点 + 跟手 + 图标"版本；
 *   ② ClipQuickActions 监听 `hs-hide-clip-actions`（按下控制点后收起浮条）；
 *   ③ G-1：在 `hs-open-clip-context-menu` 的监听里加一行日志，便于用 logcat 定位。
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';

// ① E5 落位
copyFileSync('docs/_e5-controlpoints.tsx', 'upstream-src/frontend/src/components/mobile/ClipControlPoints.tsx');
unlinkSync('docs/_e5-controlpoints.tsx');
console.log('ClipControlPoints 已替换为块外圆点版');

// ② 浮条监听 hs-hide-clip-actions
const qa = 'upstream-src/frontend/src/components/mobile/ClipQuickActions.tsx';
let q = readFileSync(qa, 'utf8');
if (!q.includes('hs-hide-clip-actions')) {
    q = q.replace(
        '        document.addEventListener("pointerdown", onDown, true);\n        return () => document.removeEventListener("pointerdown", onDown, true);',
        `        document.addEventListener("pointerdown", onDown, true);

        /* E5（用户口径）：「按下控制点后**隐藏临时的常用功能菜单**」。
           控制点浮层自己是 pointer-events:none（不能吃掉内核命中区），所以它通过窗口事件通知这里。 */
        const onHide = () => {
            const id = selectedClipIdRef.current;
            if (id !== null) setHiddenForClipId(id);
        };
        window.addEventListener("hs-hide-clip-actions", onHide);
        return () => {
            document.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("hs-hide-clip-actions", onHide);
        };`,
    );
}
writeFileSync(qa, q, 'utf8');
console.log(`浮条监听 hs-hide-clip-actions=${q.includes('hs-hide-clip-actions')}`);

// ③ G-1 加日志
const tl = 'upstream-src/frontend/src/components/layout/TimelinePanel.tsx';
let t = readFileSync(tl, 'utf8');
if (!t.includes('[g1] event')) {
    t = t.replace(
        '            const target =\n                (id ? session.clips.find((c) => c.id === id) : undefined) ?? session.clips[0];\n            if (!target) return;',
        `            const target =
                (id ? session.clips.find((c) => c.id === id) : undefined) ?? session.clips[0];
            /* 临时日志（G-1 定位用）：logcat -s Tauri/Console 可读。
               若这行不出现 ⇒ 事件没到监听；出现了但菜单仍不出 ⇒ 问题在渲染分支。 */
            console.log(
                "[g1] event clipId=",
                d.clipId,
                "selected=",
                session.selectedClipId,
                "clips=",
                session.clips.length,
                "target=",
                target?.id,
            );
            if (!target) return;`,
    );
}
writeFileSync(tl, t, 'utf8');
console.log(`G-1 日志=${t.includes('[g1] event')}`);
