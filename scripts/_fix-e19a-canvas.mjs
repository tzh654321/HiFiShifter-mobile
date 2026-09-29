#!/usr/bin/env node
/** 把 E19a 收口探针的画布选择改为真宿主 [data-piano-roll-canvas]（此前按"面积最大"选错了）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'scripts/_probe-e19a-done.mjs';
let t = readFileSync(p, 'utf8');
const old = `    const canvas = await cdp.call(() => {
        const cs = [...document.querySelectorAll('canvas')].map((c) => {
            const r = c.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return cs.filter((c) => c.w > 80 && c.h > 60).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
    });`;
const neu = `    /* ⚠️ 必须用**真宿主** [data-piano-roll-canvas]（pointer-events:auto）——
       参数面板里有 7 个同尺寸 canvas 叠加，按"面积最大"会选到 pe:none 的叠加层，
       派发过去的事件不会被处理（这个坑在本项目已坑了三次）。 */
    const canvas = await cdp.call(() => {
        const el = document.querySelector('[data-piano-roll-canvas]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pe: getComputedStyle(el).pointerEvents };
    });`;
if (t.includes(old)) {
    t = t.replace(old, neu);
    writeFileSync(p, t, 'utf8');
    console.log('已改为真宿主选择器');
} else {
    console.log('⚠️ 锚点未命中（可能已改过）');
}
