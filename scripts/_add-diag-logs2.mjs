#!/usr/bin/env node
/** 按**行号**插入诊断日志（文件里有 GBK 乱码，按文本锚点不可靠）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const insertAfterMatch = (file, re, lines2, label) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l) => re.test(l));
    if (at < 0) {
        console.log(`${label}: ⚠️ 未找到锚点行（${re}）`);
        return;
    }
    lines.splice(at + 1, 0, ...lines2);
    writeFileSync(file, lines.join('\n'), 'utf8');
    console.log(`${label}: 已在 L${at + 2} 插入 ${lines2.length} 行`);
};

// ── E11-b ────────────────────────────────────────────────────────────
const tl = 'upstream-src/frontend/src/components/layout/timeline/TrackList.tsx';
insertAfterMatch(
    tl,
    /const onTouchMove = \(ev: TouchEvent\) => \{/,
    ['            console.log("[e11][diag] touchmove finished=", finished, "touches=", ev.touches?.length);'],
    'TrackList/onTouchMove',
);
insertAfterMatch(
    tl,
    /const onTouchEnd = \(\) => \{/,
    ['            console.log("[e11][diag] touchend finished=", finished, "lastDb=", lastDb);'],
    'TrackList/onTouchEnd',
);
insertAfterMatch(
    tl,
    /function startVolumeKnobDragNow\(/,
    [],
    'TrackList/startVolumeKnobDragNow（占位）',
);

// ── E19a ─────────────────────────────────────────────────────────────
const pr = 'upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts';
insertAfterMatch(
    pr,
    /st\.points\.push\(b\);/,
    ['                        console.log("[e19a][diag] push frame=", f2, "mode=", st.mode, "points=", st.points.length);'],
    'Interactions/points.push',
);
insertAfterMatch(
    pr,
    /await commitStroke\(st\.points, st\.mode\);/,
    ['                            console.log("[e19a][diag] commit points=", st.points.length, "mode=", st.mode);'],
    'Interactions/commitStroke',
);
insertAfterMatch(
    pr,
    /strokeRef\.current = \{/,
    [],
    'Interactions/strokeRef（占位）',
);
