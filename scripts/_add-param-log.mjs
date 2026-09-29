#!/usr/bin/env node
/** 给 onCanvasPointerDown 入口加一行临时日志（logcat 可读），定位"事件是否到达"。 */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'upstream-src/frontend/src/components/layout/pianoRoll/usePianoRollInteractions.ts';
let t = readFileSync(f, 'utf8');
if (t.includes('[e19a2] down')) {
    console.log('已有日志');
} else {
    // 锚点：函数体内第一行（penEraserDown 那行）之前插入
    const anchor = 'const penEraserDown = isEraserButton(e.button, e.nativeEvent.pointerType);';
    if (t.includes(anchor)) {
        t = t.replace(
            anchor,
            `console.log("[e19a2] down button=", e.button, "type=", e.nativeEvent.pointerType, "x=", Math.round(e.clientX), "y=", Math.round(e.clientY), "tool=", String(toolMode));
            ${anchor}`,
        );
        writeFileSync(f, t, 'utf8');
        console.log('已插入 onCanvasPointerDown 入口日志');
    } else {
        // 退路：直接找 useCallback 定义后的第一行非空内容
        const lines = t.split('\n');
        const at = lines.findIndex((l) => /const onCanvasPointerDown = useCallback\(/.test(l));
        console.log(at >= 0 ? `锚点未命中；onCanvasPointerDown 在第 ${at + 1} 行` : '完全没找到 onCanvasPointerDown');
    }
}
