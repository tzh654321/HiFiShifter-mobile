#!/usr/bin/env node
/**
 * I-4 第三刀 / 性能：**前端错误上报的噪音过滤与限流**。
 *
 * 实测（真机 logcat）：`ResizeObserver loop completed with undelivered notifications`
 * **一次采样就有 2548 条**，而且它不是普通控制台输出 —— 它被
 * `installGlobalErrorReporting` 当作 **uncaught error 上报给后端**
 * （`[frontend] Uncaught error: ResizeObserver loop …`），于是经 JNI 写进 logcat
 * （`HiFiShifter` + `Tauri/Console` 双份）。这是持续的主线程/Renderer I/O 压力，
 * 与"反复切换面板后白屏"是同一类诱因，也拖慢手势响应。
 *
 * 修法（两全）：
 *   ① **过滤**规范明确"无害、可忽略"的浏览器噪音（`ResizeObserver loop`）；
 *   ② 对其余错误按 message 做**30 秒限流**（任何成因的洪水都被挡住），
 *      并给限流表加上界，避免自身无限增长。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'upstream-src/frontend/src/services/frontendErrorLog.ts';
let t = readFileSync(f, 'utf8');

const oldFn = `/** 把一条前端错误写入后端日志（fire-and-forget，永不抛出）。 */
export function reportFrontendError(message: string, detail?: unknown): void {
    try {
        const detailText = toDetailText(detail);`;

const newFn = `/**
 * 规范明确"**无害、可忽略**"的浏览器噪音：**一律不上报**。
 * 这类消息（尤其 ResizeObserver loop）会在布局抖动时**每帧**触发，
 * 上报等于把 logcat 当水管用（实测一次采样 2548 条，且经 JNI 写双份）。
 */
const IGNORED_NOISE: RegExp[] = [/ResizeObserver loop/i];

/** 同一条 message 的上报间隔下限（毫秒）：挡住任何成因的错误洪水。 */
const DEDUP_WINDOW_MS = 30_000;
/** message → 上次上报时间。 */
const lastReportedAt = new Map<string, number>();
/** 限流表自身的上界（防止被随机 message 撑爆）。 */
const DEDUP_MAX_KEYS = 200;

/** 把一条前端错误写入后端日志（fire-and-forget，永不抛出）。 */
export function reportFrontendError(message: string, detail?: unknown): void {
    try {
        // ① 已知无害噪音：直接丢弃。
        if (IGNORED_NOISE.some((re) => re.test(message))) return;
        // ② 限流：同一条 message 30 秒内只上报一次。
        const now = Date.now();
        const prev = lastReportedAt.get(message);
        if (prev !== undefined && now - prev < DEDUP_WINDOW_MS) return;
        if (lastReportedAt.size >= DEDUP_MAX_KEYS) lastReportedAt.clear();
        lastReportedAt.set(message, now);

        const detailText = toDetailText(detail);`;

if (t.includes(oldFn)) {
    t = t.replace(oldFn, newFn);
    writeFileSync(f, t, 'utf8');
    console.log('reportFrontendError: 噪音过滤 + 限流已加');
} else {
    console.log('⚠️ 锚点未命中');
}
console.log(`校验：噪音过滤=${t.includes('IGNORED_NOISE')}  限流=${t.includes('DEDUP_WINDOW_MS')}`);
