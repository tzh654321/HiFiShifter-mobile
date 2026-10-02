/**
 * E29 左右边缘「返回」手势屏蔽判据（2026-10-02，用户口径）——
 *
 * > 「系统的**划动左右边缘退出的手势**也需要屏蔽」
 *
 * 实现：`MainActivity.applyEdgeGestureExclusion()`（`View.setSystemGestureExclusionRects`）。
 * 🕳️ 系统**只能"排除"、不能"关闭"**：手势导航的返回由系统进程处理，应用无权关掉；
 * 且**每条边最多只算 200 dp**。
 *
 * 判据的三段设计（缺一段就会得出假结论）：
 *   L0 **前置自检**：先切到手势导航（`navigation_mode=2`）—— 三键导航下压根没有这个手势。
 *   L2 **对照**：从未被排除的边缘（贴顶那一小段）向内划。**它必须退出**，
 *      否则说明"注入的滑动不触发系统手势"⇒ L1 属于空转，**不能算通过**。
 *   L1 **正题**：从被排除的中段向内划 ⇒ 应用不退出。
 *   L3 **硬证据（一定能测）**：logcat 里的 `HS-EDGE exclusion rects=…`，
 *      证明 API 真被调用、且传的是左/右两块矩形。行为判据做不了时，靠它兜底。
 *
 * 🕳️ 实测（真机 221deeb / Android 15）：**`adb shell input swipe` 与 `input motionevent`
 *    注入的边缘滑动都触发不了系统返回**（对照段 y=10 照样不退出）⇒ 本机只能靠 L3 取证。
 *
 * 用法：node scripts/_probe-e29-edge-gesture.mjs <serial> [landscape|portrait]
 */
import { Cdp } from './lib/cdp.mjs';
import { execSync } from 'node:child_process';

const serial = process.argv[2] ?? process.env.ANDROID_SERIAL ?? 'emulator-5554';
const wantLandscape = (process.argv[3] ?? 'portrait') === 'landscape';
const PKG = 'com.arounder.hifishifter';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (args) => execSync(`adb -s ${serial} ${args}`, { encoding: 'utf8' }).replace(/\r/g, '');

let pass = 0;
let fail = 0;
let unknown = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}`);
    if (detail !== undefined) console.log(`     ${detail}`);
    if (ok) pass += 1;
    else fail += 1;
};
const skip = (name, detail) => {
    console.log(`⚠️ ${name}（不可判，不计入通过）`);
    if (detail !== undefined) console.log(`     ${detail}`);
    unknown += 1;
};

const focus = () =>
    (adb('shell dumpsys window').match(/mCurrentFocus=(\S+ [^\n]*)/)?.[1] ?? '').trim();
const appFocused = () => focus().includes(PKG);
const startApp = () => adb(`shell am start -n ${PKG}/.MainActivity`);

/* ── L0：导航方式（三键导航下没有边缘返回手势） ───────────────────── */
const navMode = adb('shell settings get secure navigation_mode').trim();
console.log(`▸ navigation_mode=${navMode}（2 = 手势导航）`);
const gestureNav = navMode === '2';

adb('shell settings put system accelerometer_rotation 0');
adb(`shell settings put system user_rotation ${wantLandscape ? 1 : 0}`);
await sleep(4000);

const size = adb('shell wm size').match(/(\d+)x(\d+)/);
const w = Number(size?.[1] ?? 1080);
const h = Number(size?.[2] ?? 2400);
const density = Number((adb('shell wm density').match(/(\d+)/)?.[1] ?? 3 * 160) / 160);
const long = Math.max(w, h);
const short = Math.min(w, h);
const budget = Math.min(short, Math.round(200 * density));
const midTop = Math.round((short - budget) / 2);
console.log(`▸ 屏幕 ${w}×${h}（density ${density}）⇒ 期望排除带 y ∈ [${midTop}, ${midTop + budget}]`);

startApp();
await sleep(6000);
if (!appFocused()) {
    console.log('🔴 应用不在前台，判据无法进行');
    process.exit(1);
}

/** 贴边向内划（用系统注入，模拟返回手势）。 */
const edgeSwipe = (y, fromLeft) => {
    const x0 = fromLeft ? 2 : long - 2;
    const x1 = fromLeft ? Math.round(long * 0.35) : Math.round(long * 0.65);
    adb(`shell input swipe ${x0} ${Math.round(y)} ${x1} ${Math.round(y)} 160`);
};

/* ── L2：对照（先证明"注入的滑动真的能触发返回"，否则一切免谈） ───── */
let injectionWorks = false;
if (gestureNav) {
    startApp();
    await sleep(2500);
    edgeSwipe(10, true);
    await sleep(1000);
    injectionWorks = !appFocused();
    if (injectionWorks) {
        check('E29-L2 对照：未排除的贴顶段向内划 ⇒ **仍会退出**（说明手势与注入都有效）', true, `y=10`);
    } else {
        skip('E29-L2 对照', `y=10 也没退出 ⇒ 注入方式不触发系统手势，L1 无法判`);
    }
} else {
    skip('E29-L2 对照', `本机 navigation_mode=${navMode}（非手势导航）⇒ 没有边缘返回手势`);
}

/* ── L1：正题 ─────────────────────────────────────────────────────── */
if (injectionWorks) {
    startApp();
    await sleep(2500);
    edgeSwipe(short / 2, true);
    await sleep(1000);
    check(
        'E29-L1 左边缘**中段**（已排除）向内划 ⇒ 应用**不退出**',
        appFocused(),
        `y=${Math.round(short / 2)}（排除带 ${midTop}..${midTop + budget}）`,
    );
} else {
    skip('E29-L1 左边缘中段向内划不退出', '因为对照不成立（无法区分"排除了"还是"手势没触发"）');
}

/* ── L3：硬证据（logcat） ─────────────────────────────────────────── */
startApp();
await sleep(5000);
const log = adb('shell logcat -d -s HiFiShifter:I').split('\n').filter((l) => l.includes('HS-EDGE'));
const last = log[log.length - 1] ?? '';
console.log('▸ logcat 最近一条：' + JSON.stringify(last.slice(0, 200)));
const rects = [...last.matchAll(/Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/g)].map((m) => ({
    left: +m[1],
    top: +m[2],
    right: +m[3],
    bottom: +m[4],
}));
/* 🕳️ **别用 `wm density` 当应用的 density**：真机 `wm density` 给 3.5（560dpi），
   而应用 `resources.displayMetrics.density` = **3.0** ⇒ 期望值会算错 100px/边，
   判据就会把"对的"判成错的（第一版就是这样误报的）。期望值一律从**日志里那条**
   自带的 `density=` / `w=` / `h=` 推。 */
const logDensity = Number(last.match(/density=([\d.]+)/)?.[1] ?? density);
const logW = Number(last.match(/w=(\d+)/)?.[1] ?? w);
const logH = Number(last.match(/h=(\d+)/)?.[1] ?? h);
const expBand = Math.round(200 * logDensity);
const bandPx = Math.round(44 * logDensity);
const okLeft = rects.some((r) => r.left === 0 && r.right === bandPx && r.bottom - r.top === expBand);
const okRight = rects.some((r) => r.right === logW && r.left === logW - bandPx && r.bottom - r.top === expBand);
const okCentered = rects.every((r) => Math.abs(r.top - (logH - (r.bottom - r.top)) / 2) <= 2);
check(
    'E29-L3 logcat 证明 `setSystemGestureExclusionRects` 真被调用：左右各一块、宽 44dp、高 200dp、纵向居中',
    rects.length >= 2 && okLeft && okRight && okCentered,
    `rects=${JSON.stringify(rects)} 期望：宽 ${bandPx}×高 ${expBand}（density=${logDensity} / w=${logW} h=${logH}）`,
);

startApp();
await sleep(1500);
console.log(`\n── E29 边缘返回手势：通过 ${pass} / 失败 ${fail} / 不可判 ${unknown} ──`);
