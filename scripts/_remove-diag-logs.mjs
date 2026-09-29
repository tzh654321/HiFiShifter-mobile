#!/usr/bin/env node
/** 移除 E11-b / E19a 的临时诊断日志（按标记行删除）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
    'upstream-src/frontend/src/components/layout/timeline/TrackList.tsx',
    'upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts',
];

for (const f of files) {
    const before = readFileSync(f, 'utf8');
    const lines = before.split('\n');
    const kept = lines.filter((l) => !/\[e11\]\[diag\]|\[e19a\]\[diag\]/.test(l));
    const removed = lines.length - kept.length;
    if (removed > 0) writeFileSync(f, kept.join('\n'), 'utf8');
    console.log(`${f.split('/').pop()}: 移除 ${removed} 行`);
}
