#!/usr/bin/env node
/**
 * 真机**内核级**触控注入（`sendevent` → `/dev/input/eventX`）。
 *
 * 为什么需要它：CDP 的 `Input.dispatchTouchEvent` 走浏览器输入管线，
 * **不触发 Android WebView 的原生手势**（原生长按 / touch-action 接管 /
 * 真实 `pointercancel` 时序）⇒ 双指一类的手势在探针里永远绿、真机永远红。
 * `sendevent` 注入的是**内核输入事件**，Android 把它当真手指（能触发原生长按），
 * 是目前唯一能**自主复现**真机手势的办法（设备需 root）。
 *
 * 坐标：命令行一律用 **CSS px**（与页内 `getBoundingClientRect()` 同一坐标系），
 * 内部按 `dpr` 与触摸板 raw 范围换算。
 *
 * 用法：
 *   node scripts/_dbg-touchsel.mjs --serial 221deeb --tap 180,300
 *   node scripts/_dbg-touchsel.mjs --serial 221deeb --two 180,300 220,300 --hold 600 --dx -60 --steps 6
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const argv = process.argv;
const o = {
    serial: '221deeb',
    dev: '/dev/input/event6',
    screen: [1080, 2376],
    raw: [20224, 44480],
    dpr: 3,
    tap: null,
    two: null,
    hold: 600,
    dx: 0,
    dy: 0,
    steps: 6,
};
for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') o.serial = argv[++i];
    else if (a === '--dev') o.dev = argv[++i];
    else if (a === '--screen') o.screen = argv[++i].split('x').map(Number);
    else if (a === '--raw') o.raw = argv[++i].split('x').map(Number);
    else if (a === '--dpr') o.dpr = Number(argv[++i]);
    else if (a === '--tap') o.tap = argv[++i].split(',').map(Number);
    else if (a === '--two') {
        o.two = [argv[++i].split(',').map(Number), argv[++i].split(',').map(Number)];
    } else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--dx') o.dx = Number(argv[++i]);
    else if (a === '--dy') o.dy = Number(argv[++i]);
    else if (a === '--steps') o.steps = Number(argv[++i]);
}

/* CSS px → raw 触摸板坐标 */
const toRaw = (cssX, cssY) => [
    Math.round(((cssX * o.dpr) / o.screen[0]) * o.raw[0]),
    Math.round(((cssY * o.dpr) / o.screen[1]) * o.raw[1]),
];

/* Linux input 事件码 */
const EV_SYN = 0, EV_KEY = 1, EV_ABS = 3;
const SYN_REPORT = 0;
const BTN_TOUCH = 330;
const ABS_MT_SLOT = 47, ABS_MT_TOUCH_MAJOR = 48, ABS_MT_POSITION_X = 53,
      ABS_MT_POSITION_Y = 54, ABS_MT_TRACKING_ID = 57;

const L = [];
const ev = (type, code, value) => L.push(`sendevent ${o.dev} ${type} ${code} ${value}`);
const syn = () => ev(EV_SYN, SYN_REPORT, 0);
const down = (slot, id, x, y) => {
    ev(EV_ABS, ABS_MT_SLOT, slot);
    ev(EV_ABS, ABS_MT_TRACKING_ID, id);
    ev(EV_ABS, ABS_MT_POSITION_X, x);
    ev(EV_ABS, ABS_MT_POSITION_Y, y);
    ev(EV_ABS, ABS_MT_TOUCH_MAJOR, 8);
};
const move = (slot, x, y) => {
    ev(EV_ABS, ABS_MT_SLOT, slot);
    ev(EV_ABS, ABS_MT_POSITION_X, x);
    ev(EV_ABS, ABS_MT_POSITION_Y, y);
};
const up = (slot) => {
    ev(EV_ABS, ABS_MT_SLOT, slot);
    ev(EV_ABS, ABS_MT_TRACKING_ID, -1);
};
const sl = (sec) => L.push(`sleep ${sec}`);

if (o.tap) {
    const [rx, ry] = toRaw(o.tap[0], o.tap[1]);
    down(0, 100, rx, ry);
    ev(EV_KEY, BTN_TOUCH, 1);
    syn();
    sl(0.08);
    up(0);
    ev(EV_KEY, BTN_TOUCH, 0);
    syn();
    console.log(`tap css=(${o.tap}) → raw=(${rx},${ry})`);
} else if (o.two) {
    const [p0, p1] = o.two;
    const [a0x, a0y] = toRaw(p0[0], p0[1]);
    const [a1x, a1y] = toRaw(p1[0], p1[1]);
    /* 第一指落下 */
    down(0, 100, a0x, a0y);
    ev(EV_KEY, BTN_TOUCH, 1);
    syn();
    sl(0.09);
    /* 第二指落下 */
    down(1, 101, a1x, a1y);
    syn();
    /* 长按等待（越过 500ms 门控） */
    sl((o.hold / 1000).toFixed(3));
    /* 两指一起平移 */
    for (let i = 1; i <= o.steps; i++) {
        const t = i / o.steps;
        move(0, Math.round(a0x + o.dx * t * o.dpr * (o.raw[0] / o.screen[0])), Math.round(a0y + o.dy * t * o.dpr * (o.raw[1] / o.screen[1])));
        move(1, Math.round(a1x + o.dx * t * o.dpr * (o.raw[0] / o.screen[0])), Math.round(a1y + o.dy * t * o.dpr * (o.raw[1] / o.screen[1])));
        syn();
        sl(0.05);
    }
    up(1);
    sl(0.05);
    up(0);
    ev(EV_KEY, BTN_TOUCH, 0);
    syn();
    console.log(`two css=(${p0})/(${p1}) hold=${o.hold}ms dx=${o.dx} dy=${o.dy} steps=${o.steps}`);
} else {
    console.error('需要 --tap x,y 或 --two x1,y1 x2,y2');
    process.exit(2);
}

const sh = '#!/system/bin/sh\n' + L.join('\n') + '\n';
writeFileSync('D:\\Temp\\hs-touch.sh', sh);
console.log(`帧数=${L.length}（含 sleep ${L.filter((l) => l.startsWith('sleep')).length}）`);
execSync(`adb -s ${o.serial} push D:/Temp/hs-touch.sh /data/local/tmp/hs-touch.sh`, { stdio: 'ignore' });
const out = execSync(`adb -s ${o.serial} shell su -c "sh /data/local/tmp/hs-touch.sh" 2>&1`).toString().trim();
console.log(out ? '设备输出：' + out : '注入完成（无输出）');
