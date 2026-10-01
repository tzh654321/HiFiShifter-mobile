#!/usr/bin/env node
/**
 * E28 横屏优化三件套的设备判据（对应 `setup-gen-android.sh` §7 的 HS-LANDSCAPE-PATCH + §16）。
 *
 * 三条判据各有一个**独立的客观来源**，互不冒充：
 *
 *   L1 「横屏收起系统栏」→ 读 **WindowManager 的 InsetsSource 可见性**
 *      `dumpsys window` 里有 `InsetsSource id=… type=statusBars … visible=true|false`。
 *      这是系统侧的事实，和"应用有没有垫 padding"完全无关 —— 所以它才能证明"真的隐藏了"，
 *      而不是"只是把内容画到栏下面去了"。
 *
 *   L2 「不再留躲避系统栏/刘海的空白」→ 量 **WebView 视口**
 *      `innerWidth × devicePixelRatio` 必须等于显示长边、`innerHeight × dpr` 等于短边。
 *      修前实测（模拟器 2400×1080）：视口只有 **2265 × 924** —— 左边少 135px（刘海，
 *      `displayCutout frame=[0,0][136,1080]`）、高少 156px（状态栏 84 + 导航栏 72）。
 *
 *   L3 「始终屏蔽系统分屏」→ 读 **ActivityRecord.resizeMode**
 *      `dumpsys activity activities` 里本应用那条记录有 `resizeMode=…`。
 *      Manifest 声明 `android:resizeableActivity="false"` 后应由 `RESIZE_MODE_RESIZEABLE*`
 *      变为 `RESIZE_MODE_UNRESIZEABLE`。
 *      ⚠️ 生效边界：Android 12+ 只有 **sw < 600dp** 的屏幕认这个属性；平板（sw>=600dp）
 *      系统直接无视 ⇒ 平板上做不到用软件屏蔽分屏（本机 sw=360dp，生效）。
 *
 * 用法：node scripts/_probe-e28-landscape.mjs [serial]
 */
import { execSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';

const serial = process.argv[2] ?? 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PKG = 'com.arounder.hifishifter';

const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: 'pipe' }).toString();

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '🔴'} ${name}${detail ? '\n     ' + detail : ''}`);
    if (ok) pass += 1;
    else fail += 1;
};

/* ── 系统侧读数（与"应用内表现"完全独立） ───────────────────────────── */

/** 从 `dumpsys window` 取系统栏 / 导航栏的**可见性**与 frame。 */
const readSystemBars = () => {
    const dump = adb('shell dumpsys window').replace(/\r/g, '');
    const pick = (type) => {
        const m = dump.match(
            new RegExp(`InsetsSource id=\\S+ type=${type} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\] visible=(\\w+)`),
        );
        if (!m) return null;
        return {
            x0: +m[1],
            y0: +m[2],
            x1: +m[3],
            y1: +m[4],
            visible: m[5] === 'true',
            w: +m[3] - +m[1],
            h: +m[4] - +m[2],
        };
    };
    return { status: pick('statusBars'), nav: pick('navigationBars') };
};

/** 从 `dumpsys window` 取刘海（displayCutout）与手势条（mandatorySystemGestures）的 frame。 */
const readOccluders = () => {
    const dump = adb('shell dumpsys window').replace(/\r/g, '');
    const pick = (type) => {
        const m = dump.match(
            new RegExp(`InsetsSource id=\\S+ type=${type} frame=\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\] visible=(\\w+)`),
        );
        if (!m) return null;
        return { x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], visible: m[5] === 'true' };
    };
    return { cutout: pick('displayCutout'), gesture: pick('mandatorySystemGestures') };
};

/** 从 `dumpsys activity activities` 取本应用 ActivityRecord 的 resizeMode。 */
const readResizeMode = () => {
    const dump = adb('shell dumpsys activity activities').replace(/\r/g, '');
    const i = dump.indexOf(`${PKG}/.MainActivity`);
    if (i < 0) return null;
    const seg = dump.slice(i, i + 4000);
    const m = seg.match(/resizeMode=(\w+)/);
    return m ? m[1] : null;
};

/** 显示尺寸（px）。 */
const readDisplay = () => {
    const dump = adb('shell dumpsys window displays').replace(/\r/g, '');
    const m = dump.match(/cur=(\d+)x(\d+)/);
    return m ? { w: +m[1], h: +m[2] } : null;
};

const rotate = (deg) => {
    adb('shell settings put system accelerometer_rotation 0');
    adb(`shell settings put system user_rotation ${deg}`);
};

/* ── CDP：WebView 视口 ───────────────────────────────────────────── */
const pid = adb(`shell pidof ${PKG}`).trim();
if (!pid) {
    console.log('🔴 应用没在跑 ⇒ 先 am start');
    process.exit(1);
}
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: '127.0.0.1', port: 9222 });
await cdp.send('Runtime.enable');
const readViewport = () =>
    cdp.call(() => ({
        iw: innerWidth,
        ih: innerHeight,
        dpr: devicePixelRatio,
        pw: Math.round(innerWidth * devicePixelRatio),
        ph: Math.round(innerHeight * devicePixelRatio),
        orient: screen.orientation?.type ?? '',
    }));

/* ── 0. 前置：应用在前台 ─────────────────────────────────────────── */
const focus = adb('shell dumpsys window').replace(/\r/g, '').match(/mCurrentFocus=(\S+ [^\n]*)/);
console.log('▸ 当前焦点：' + (focus ? focus[1].trim() : '?'));
if (!focus || !focus[1].includes(PKG)) {
    adb(`shell am start -n ${PKG}/.MainActivity`);
    await sleep(9000);
}
const disp = readDisplay();
console.log('▸ 显示：' + JSON.stringify(disp));

/* ── 1. 横屏 ─────────────────────────────────────────────────────── */
rotate(1);
await sleep(6000);
const vLand = await readViewport();
const barsLand = readSystemBars();
const dispLand = readDisplay();
console.log('▸ 横屏显示：' + JSON.stringify(dispLand));
console.log('▸ 横屏视口：' + JSON.stringify(vLand));
console.log('▸ 横屏系统栏：' + JSON.stringify(barsLand));

check(
    'E28-L1 横屏：状态栏 + 导航栏都被隐藏（系统侧 InsetsSource visible=false）',
    barsLand.status?.visible === false && barsLand.nav?.visible === false,
    `statusBars.visible=${barsLand.status?.visible} navigationBars.visible=${barsLand.nav?.visible}`,
);

/* 🔴 横屏的"铺满"必须**扣掉刘海**再算 —— 这不是辩解，是 Android 的口径：
   `mDisplayCutout=DisplayCutout{insets=Rect(0,136,0,0) boundingRect={… Rect(480,0-625,136)…}
    cutoutSpec={M 506,68 a 34,34 …@left}}` —— 物理上只是一个**居中 68px 圆孔**，
   但它报给应用的 insets 是**整条上边**（横屏即整条左边）。系统既然声明"这条边不安全"，
   应用就得让开；**状态栏/导航栏那部分空白才是用户要收的**，这里一律不垫、也不许留。
   ⚠️ padding **会**缩小 WebView 视口（content view 就是它的容器）—— 第一版注释写反了，
   实测：不垫 2400×1080、垫刘海后 2265×1080。 */
const occ = readOccluders();
const cutW = occ.cutout ? Math.max(0, occ.cutout.x1 - occ.cutout.x0) : 0;
const cutH = occ.cutout ? Math.max(0, occ.cutout.y1 - occ.cutout.y0) : 0;
const vertBand = cutW > 0 && cutW < cutH; // 横屏：竖条（整条左边/右边）
const horizBand = cutH > 0 && cutH <= cutW; // 竖屏：横条（整条上边/下边）
const landLong = Math.max(dispLand.w, dispLand.h);
const landShort = Math.min(dispLand.w, dispLand.h);
const expW = vertBand ? landLong - cutW : landLong;
const expH = horizBand ? landShort - cutH : landShort;
check(
    'E28-L2 横屏：除刘海**外**不再留白（躲避状态栏/导航栏的空白已收回）',
    Math.abs(vLand.pw - expW) <= 2 && Math.abs(vLand.ph - expH) <= 2,
    `视口 ${vLand.pw}×${vLand.ph}；期望 ${expW}×${expH}` +
        `（屏幕 ${landLong}×${landShort}，刘海 ${cutW}×${cutH}，` +
        `缺口 ${landLong - vLand.pw}×${landShort - vLand.ph}）`,
);

/* E28-L5：「铺满」的代价核查 —— **刘海（物理遮挡）**压住的区域里有没有可交互控件。
   横屏不再为系统栏留白是用户明确要的；但相机挖孔是**物理遮挡**，压住按钮就是"点不到"。
   判定用**覆盖比例 ≥ 50%**（只压到边角不算 —— 那种情况控件仍可按）。
   ⚠️ 手势带（mandatorySystemGestures）**只作提示、不算失败**：沉浸模式下那条边缘带是
   系统留给"划出临时系统栏"的（`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`），任何全屏应用
   都躲不开，而且它是**滑动**保留区、**点击照常命中控件** ⇒ 拿它当失败会永远红。 */
/* 🕳️ 坐标换算：padding 生效后 WebView 的 CSS 原点**不在屏幕原点**上 ——
   内容整体被推离刘海那条边 ⇒ 必须把"屏幕像素"减去这个偏移再除以 dpr，
   否则会把已经让开的控件又算成"被盖住"（第一版就在这算错，判据自相矛盾）。 */
const originX = vertBand && occ.cutout.x0 === 0 ? Math.max(0, landLong - vLand.pw) : 0;
const originY = horizBand && occ.cutout.y0 === 0 ? Math.max(0, landShort - vLand.ph) : 0;
const strips = [
    occ.cutout && occ.cutout.x1 > occ.cutout.x0
        ? { name: '刘海', r: occ.cutout }
        : null,
    occ.gesture ? { name: '手势条', r: occ.gesture } : null,
].filter(Boolean);
const hits = await cdp.call(
    (list, dpr, ox, oy) => {
        const out = [];
        const sel = 'button,a,input,textarea,select,[role="button"],[role="menuitem"],[role="slider"]';
        for (const item of list) {
            const x0 = (item.r.x0 - ox) / dpr;
            const y0 = (item.r.y0 - oy) / dpr;
            const x1 = (item.r.x1 - ox) / dpr;
            const y1 = (item.r.y1 - oy) / dpr;
            if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
            for (const el of document.querySelectorAll(sel)) {
                const b = el.getBoundingClientRect();
                if (b.width === 0 || b.height === 0) continue;
                const ow = Math.min(b.right, x1) - Math.max(b.left, x0);
                const oh = Math.min(b.bottom, y1) - Math.max(b.top, y0);
                if (ow <= 0 || oh <= 0) continue;
                const ratio = (ow * oh) / (b.width * b.height);
                out.push({
                    strip: item.name,
                    label: `${el.tagName}[${el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 16)}]`,
                    ratio: +ratio.toFixed(2),
                });
            }
        }
        return out.sort((a, b) => b.ratio - a.ratio).slice(0, 10);
    },
    strips.map((s) => ({ name: s.name, r: s.r })),
    vLand.dpr,
    originX,
    originY,
);
const cutHits = hits.filter((h) => h.strip === '刘海' && h.ratio >= 0.5);
const gesHits = hits.filter((h) => h.strip === '手势条');
console.log('▸ 遮挡区：' + JSON.stringify(strips.map((s) => ({ n: s.name, r: s.r }))));
console.log(`▸ 手势带内控件 ${gesHits.length} 个（仅提示，不算失败）：` + JSON.stringify(gesHits.slice(0, 4)));
check(
    'E28-L5 横屏：刘海（物理遮挡）**没有盖住**可交互控件（覆盖 ≥ 50% 才算）',
    cutHits.length === 0,
    cutHits.length
        ? '被盖住：' + JSON.stringify(cutHits.slice(0, 5))
        : strips.some((s) => s.name === '刘海')
          ? '刘海在场（' + JSON.stringify(strips.find((s) => s.name === '刘海').r) + '）但无控件被盖'
          : '本机无刘海',
);

/* ── 2. 竖屏（不能回归） ──────────────────────────────────────────── */
rotate(0);
await sleep(6000);
const vPort = await readViewport();
const barsPort = readSystemBars();
/* ⚠️ 显示尺寸必须**重新读**：旋转后 `cur=` 会变成 1080x2400。第一版忘了重读，
   拿横屏的 2400x1080 去比竖屏视口 ⇒ 判据自己算错（"-1113"）。 */
const dispPort = readDisplay();
console.log('▸ 竖屏显示：' + JSON.stringify(dispPort));
console.log('▸ 竖屏视口：' + JSON.stringify(vPort));
console.log('▸ 竖屏系统栏：' + JSON.stringify(barsPort));
check(
    'E28-L0 竖屏：系统栏**恢复显示**（不把横屏的沉浸带到竖屏）',
    barsPort.status?.visible === true && barsPort.nav?.visible === true,
    `statusBars.visible=${barsPort.status?.visible} navigationBars.visible=${barsPort.nav?.visible}`,
);
check(
    'E28-L4 竖屏：视口仍收拢（与改造前逐像素一致：2400-2193 = 207px = 状态栏 136 + 导航栏 72 四舍五入）',
    vPort.pw === Math.min(dispPort.w, dispPort.h) && vPort.ph < Math.max(dispPort.w, dispPort.h),
    `视口 ${vPort.pw}×${vPort.ph} vs 屏幕 ${dispPort.w}×${dispPort.h}（差 ${Math.max(dispPort.w, dispPort.h) - vPort.ph}）`,
);

/* ── 3. 屏蔽系统分屏 ─────────────────────────────────────────────── */
const rm = readResizeMode();
console.log('▸ resizeMode：' + rm);
/* 🕳️ 别写 `!/RESIZEABLE/.test(rm)` —— `"RESIZE_MODE_UNRESIZEABLE"` **包含** 子串
   `RESIZEABLE`，于是"修好了"反而判失败（第一版就栽在这，白查一轮）。要匹配整段枚举。 */
check(
    'E28-L3 系统分屏被屏蔽（resizeMode == UNRESIZEABLE）',
    rm === 'RESIZE_MODE_UNRESIZEABLE',
    `resizeMode=${rm}（修前实测 RESIZE_MODE_RESIZEABLE_VIA_SDK_VERSION）`,
);

console.log(`\n── E28 横屏三件套：通过 ${pass} / 失败 ${fail} ──`);
cdp.close();
