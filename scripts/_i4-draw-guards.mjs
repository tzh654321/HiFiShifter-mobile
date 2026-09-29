#!/usr/bin/env node
/**
 * I-4（E10-② 白屏）的第一刀：**消除 WebGL 空渲染调用**。
 *
 * 证据（早前真机 logcat）：`[.WebGL-…]RENDER WARNING: Render count or primcount is 0.`
 * **每帧多条**，而每条都要经 JNI 写进 logcat（`RustStdoutStderr` + `Tauri/Console` 双份）
 * ⇒ 日志 I/O 长期占用主线程/渲染线程，是"反复切换面板后渲染进程被杀（白屏 + 灰框哭脸）"
 * 的合理诱因之一。
 *
 * 修法：`count <= 0` 时**根本不调用** draw（GL 不画任何东西，但驱动/校验层不再记录警告）。
 * 纯守卫、不改任何可见行为。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = [
    'upstream-src/frontend/src/components/layout/renderKernel/gl/glyphProgram.ts',
    'upstream-src/frontend/src/components/layout/renderKernel/gl/sdfBoxProgram.ts',
    'upstream-src/frontend/src/components/layout/renderKernel/gl/polylineProgram.ts',
    'upstream-src/frontend/src/components/layout/timeline/gl/timelineClipGlRenderer.ts',
];

const RULES = [
    [
        'gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);',
        'if (count > 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count); /* I-4：count=0 不画，避免 "Render count is 0" 警告洪水 */',
    ],
    [
        'gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, uploadedCount);',
        'if (uploadedCount > 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, uploadedCount); /* I-4 */',
    ],
    [
        'gl.drawArrays(gl.TRIANGLES, 0, count);',
        'if (count > 0) gl.drawArrays(gl.TRIANGLES, 0, count); /* I-4：count=0 不画 */',
    ],
    [
        'gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.max(0, this.uploadedInstanceCount));',
        'if (this.uploadedInstanceCount > 0) { gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.uploadedInstanceCount); } /* I-4 */',
    ],
];

let total = 0;
for (const file of TARGETS) {
    let text = readFileSync(file, 'utf8');
    let n = 0;
    for (const [from, to] of RULES) {
        if (text.includes(from) && !text.includes(to.split(' /*')[0] + ' /* I-4')) {
            text = text.split(from).join(to);
            n += 1;
        }
    }
    if (n > 0) {
        writeFileSync(file, text, 'utf8');
        total += n;
    }
    console.log(`${file.split('/').pop()}: 加守卫 ${n} 处`);
}
console.log(`合计 ${total} 处`);
