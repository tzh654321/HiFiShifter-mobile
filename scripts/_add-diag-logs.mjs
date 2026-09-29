#!/usr/bin/env node
/**
 * 给 E11-b（增益长按拖动）与 E19a（还原画笔拖动）加**临时诊断日志**。
 * 两处都是"代码路径看起来对、行为却不对"，只有运行期证据能分辨。
 * logcat -s Tauri/Console 可读（本项目 console 会进 logcat）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

// ── E11-b：增益旋钮的触摸拖动 ──────────────────────────────────────────
const tl = 'upstream-src/frontend/src/components/layout/timeline/TrackList.tsx';
let t = readFileSync(tl, 'utf8');
if (!t.includes('[e11] touchmove')) {
    t = t.replace(
        `        const onTouchMove = (ev: TouchEvent) => {
            if (finished) return;
            const t = ev.touches[0];
            if (!t) return;
            if (ev.cancelable) ev.preventDefault();
            const deltaY = startY - t.clientY;
            const nextDb = clampGainDb(startDb + deltaY * TRACK_GAIN_DRAG_DB_PER_PX);
            if (Math.abs(nextDb - lastDb) < 0.01) return;
            lastDb = nextDb;
            onVolumeUiChange(trackId, dbToGain(nextDb));
        };`,
        `        const onTouchMove = (ev: TouchEvent) => {
            console.log("[e11] touchmove finished=", finished, "touches=", ev.touches.length);
            if (finished) return;
            const t = ev.touches[0];
            if (!t) return;
            if (ev.cancelable) ev.preventDefault();
            const deltaY = startY - t.clientY;
            const nextDb = clampGainDb(startDb + deltaY * TRACK_GAIN_DRAG_DB_PER_PX);
            console.log("[e11] dy=", Math.round(deltaY), "startDb=", startDb, "nextDb=", nextDb, "lastDb=", lastDb);
            if (Math.abs(nextDb - lastDb) < 0.01) return;
            lastDb = nextDb;
            onVolumeUiChange(trackId, dbToGain(nextDb));
            console.log("[e11] onVolumeUiChange called gain=", dbToGain(nextDb));
        };`,
    );
    // 同时记录 onTouchEnd 与 tearDown 的提交
    t = t.replace(
        `        const onTouchEnd = () => {
            if (finished) return;
            finished = true;
            setVolumeHoveredTrackId(null);
            tearDown();
        };`,
        `        const onTouchEnd = () => {
            console.log("[e11] touchend finished=", finished, "lastDb=", lastDb);
            if (finished) return;
            finished = true;
            setVolumeHoveredTrackId(null);
            tearDown();
        };`,
    );
    // 以及 startVolumeKnobDragNow 是否真被调用
    t = t.replace(
        `        if (!fromLongPress && shouldSuppressHoverSideEffects(e.nativeEvent)) return;`,
        `        console.log("[e11] startDrag fromLongPress=", fromLongPress);
        if (!fromLongPress && shouldSuppressHoverSideEffects(e.nativeEvent)) return;`,
    );
}
writeFileSync(tl, t, 'utf8');
console.log(`TrackList: e11 日志=${t.includes('[e11] touchmove')}`);

// ── E19a：还原画笔的 stroke 累积 ──────────────────────────────────────
const pr = 'upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts';
let p = readFileSync(pr, 'utf8');
if (!p.includes('[e19a]')) {
    p = p.replace(
        `                    } else if (last) {
                        const a = { frame: last.frame, value: last.value };
                        const b = { frame: f2, value: v2 };
                        st.points.push(b);`,
        `                    } else if (last) {
                        const a = { frame: last.frame, value: last.value };
                        const b = { frame: f2, value: v2 };
                        st.points.push(b);
                        console.log("[e19a] push frame=", f2, "mode=", st.mode, "points=", st.points.length);`,
    );
    p = p.replace(
        `                        } else {
                            await commitStroke(st.points, st.mode);`,
        `                        } else {
                            console.log("[e19a] commit points=", st.points.length, "mode=", st.mode, "first=", st.points[0]?.frame, "last=", st.points[st.points.length - 1]?.frame);
                            await commitStroke(st.points, st.mode);`,
    );
    // down 也记一笔
    p = p.replace(
        `            strokeRef.current = {
                mode,
                pointerId: e.pointerId,
                param: editParam,
                points: [{ frame, value }],
            };`,
        `            strokeRef.current = {
                mode,
                pointerId: e.pointerId,
                param: editParam,
                points: [{ frame, value }],
            };
            console.log("[e19a] down toolMode=", String(toolMode), "mode=", mode, "frame=", frame);`,
    );
}
writeFileSync(pr, p, 'utf8');
console.log(`usePianoRollInteractions: e19a 日志=${p.includes('[e19a] push')}`);
