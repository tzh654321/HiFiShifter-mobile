#!/usr/bin/env node
/**
 * 触摸驱动 —— 把 `docs/05` §8.5 的「**点得到**」这一步变成可复跑的动作。
 *
 * 为什么必须走 CDP：`adb shell input` **做不了多指**，而验收要求"模拟点击/划动/多指"
 * 逐项过。CDP 的 `Input.dispatchTouchEvent` 一次可以带多个 `touchPoints`，
 * 双指缩放/平移就能真派发出去。
 *
 * ⚠️ 坐标系：CDP 的触摸坐标是 **CSS px、相对 WebView 视口**（与
 * `layout-audit.mjs` 输出的 `rect` 同一套坐标），**不是**截图的设备像素。
 * 视口 360 宽时，x 只应落在 0..360；拿 1080 宽的截图坐标直接喂进来会全部落在视口外。
 *
 * 用法:
 *   node scripts/touch-drive.mjs probe <x> <y>                     # 只报告该点命中谁
 *   node scripts/touch-drive.mjs tap   <x> <y> [--hold ms]         # 单击（+ 前后状态摘要）
 *   node scripts/touch-drive.mjs swipe <x1> <y1> <x2> <y2> [ms]    # 单指划动
 *   node scripts/touch-drive.mjs pinch <cx> <cy> <r1> <r2> [ms]    # 双指缩放（r1→r2，两指沿水平方向）
 *   node scripts/touch-drive.mjs pan2  <cx> <cy> <dx> <dy> [ms]    # 双指平移（两指同向移动 dx,dy）
 *
 * 公共参数：
 *   --port 9222  --host 127.0.0.1  --steps N（插值步数，默认 12）  --json out.json
 *   --no-state（不做前后状态摘要）
 *
 * 前置：见 scripts/lib/cdp.mjs 顶部（adb forward tcp:9222 …）
 */
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

// ── 页面内取状态摘要（序列化后送进 WebView）────────────────────────────────
function inPageState() {
  const trunc = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const active = document.activeElement;
  const selected = [...document.querySelectorAll('[aria-selected="true"],[data-state="checked"],[data-active="true"]')]
    .map((e) => trunc(e.getAttribute('aria-label') || e.textContent, 18))
    .slice(0, 8);
  const inputs = [...document.querySelectorAll('input,textarea')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => trunc(e.value, 16))
    .slice(0, 8);
  // 应用自己的状态条/提示（canvas 类交互的状态变化只能从这里看）
  const texts = [...document.querySelectorAll('[class*="status"],[class*="hint"],[class*="error"],[role="status"]')]
    .map((e) => trunc(e.textContent, 30))
    .filter(Boolean)
    .slice(0, 5);
  return {
    active: active ? trunc(active.getAttribute('aria-label') || active.tagName + '.' + (active.className || '').slice(0, 24), 30) : null,
    selected,
    inputs,
    texts,
    bodyLen: (document.body.innerText || '').length,
  };
}

function inPageHit(x, y) {
  const desc = (e) =>
    e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ((e.className || '').toString().split(/\s+/)[0] ? '.' + (e.className || '').toString().split(/\s+/)[0] : '');

  // ⚠️ 不能只按标签名判「可交互」：React 应用大量使用 `<div onClick>`，
  // 光看 tagName/role/tabindex 会把真的能点的菜单项判成"点不到"（实测踩到过）。
  // 处理器藏在 React 挂在 DOM 节点上的 `__reactProps$…` 里。
  const hasHandler = (e) => {
    if (!e) return false;
    if (typeof e.onclick === 'function') return true;
    for (const k of Object.keys(e)) {
      if (k.startsWith('__reactProps$') || k.startsWith('__reactEvents$')) {
        const p = e[k];
        if (p && (p.onClick || p.onPointerDown || p.onMouseDown || p.onTouchStart || p.onPointerUp)) return true;
      }
    }
    return false;
  };

  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const chain = [];
  let p = el;
  for (let i = 0; p && i < 5; i++, p = p.parentElement) chain.push(desc(p));

  // 真正接收这次点击的，是**最近的带处理器的祖先**（事件冒泡）
  let owner = el;
  while (owner && owner !== document.body && !hasHandler(owner)) owner = owner.parentElement;
  const ownerInfo = owner && owner !== document.body
    ? { sel: desc(owner), text: (owner.getAttribute('aria-label') || owner.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) }
    : null;

  const r = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const semantic = /^(a|button|input|select|textarea|summary)$/.test(tag) || !!el.closest('button,a,input,select,textarea,[role="button"],[role="tab"],[tabindex]');
  return {
    tag,
    chain,
    text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    rect: { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    cursor: getComputedStyle(el).cursor,
    semantic,
    handlerOwner: ownerInfo,
    // 判据：语义化可交互元素 **或** 最近冒泡祖先上有处理器
    interactive: semantic || !!ownerInfo,
  };
}

/** 按文字找元素（返回矩形 + 最近处理器宿主），用于定位该点哪里。 */
function inPageFind(needle, exact) {
  const out = [];
  const hit = [...document.querySelectorAll('*')].filter((e) => {
    if (e.children.length) return false; // 只看叶子，避免把整条菜单栏算进来
    const t = (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    return exact ? t === needle : t.includes(needle);
  });
  for (const e of hit.slice(0, 40)) {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let owner = e;
    const has = (n) => {
      for (const k of Object.keys(n)) {
        if (k.startsWith('__reactProps$')) {
          const p = n[k];
          if (p && (p.onClick || p.onPointerDown || p.onTouchStart)) return true;
        }
      }
      return typeof n.onclick === 'function';
    };
    while (owner && owner !== document.body && !has(owner)) owner = owner.parentElement;
    out.push({
      text: (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      sel: e.tagName.toLowerCase() + ((e.className || '').toString().split(/\s+/)[0] ? '.' + (e.className || '').toString().split(/\s+/)[0] : ''),
      center: [+(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1)],
      rect: { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      clickable: owner && owner !== document.body,
    });
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    cmd: argv[0], nums: [], strs: [],
    host: '127.0.0.1', port: 9222, steps: 12, json: null, state: true, hold: 60, exact: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') o.host = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--steps') o.steps = Number(argv[++i]);
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--no-state') o.state = false;
    else if (a === '--exact') o.exact = true;
    else if (a.startsWith('--')) {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    } else if (a !== '' && Number.isFinite(Number(a))) o.nums.push(Number(a));
    else o.strs.push(a);
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { cmd, nums } = o;
  const CMDS = ['probe', 'find', 'eval', 'tap', 'swipe', 'pinch', 'pan2'];
  if (!cmd || !CMDS.includes(cmd)) {
    console.log(
      [
        '用法:',
        '  node scripts/touch-drive.mjs probe <x> <y>                     # 该点命中谁、最近处理器宿主是谁',
        '  node scripts/touch-drive.mjs find  <文字> [--exact]            # 按文字找控件，输出中心点与 rect',
        '  node scripts/touch-drive.mjs eval  "<js 表达式>"               # 在页面里求值（诊断用）',
        '  node scripts/touch-drive.mjs tap   <x> <y> [--hold ms]         # 单击（附前后状态摘要）',
        '  node scripts/touch-drive.mjs swipe <x1> <y1> <x2> <y2> [ms]    # 单指划动',
        '  node scripts/touch-drive.mjs pinch <cx> <cy> <r1> <r2> [ms]    # 双指缩放',
        '  node scripts/touch-drive.mjs pan2  <cx> <cy> <dx> <dy> [ms]    # 双指平移',
        '',
        '⚠️ 坐标是 CSS px、相对 WebView 视口（不是截图的设备像素）。',
      ].join('\n'),
    );
    return 2;
  }

  const cdp = await Cdp.attach({ host: o.host, port: o.port });
  await cdp.send('Runtime.enable');
  const vp = await cdp.call(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
  console.log(`▸ 目标: ${cdp.page.url}  视口 ${vp.w}×${vp.h} CSS  (dpr ${vp.dpr})`);

  // 坐标范围体检：最常见的错就是拿截图的设备像素当 CSS 像素用（差 dpr 倍）
  if (nums.length >= 2) {
    const pairs = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pairs.push([nums[i], nums[i + 1]]);
    const bad = pairs.filter(([x, y]) => x < 0 || x > vp.w || y < 0 || y > vp.h);
    if (bad.length) {
      console.log(`⚠️ 有 ${bad.length} 个点超出视口 ${vp.w}×${vp.h}：${bad.map((p) => `(${p[0]},${p[1]})`).join(' ')}`);
      console.log('   若这些数是从截图量的，记得先除以 devicePixelRatio。');
    }
  }

  const touch = (type, points, timeoutMs = 15000) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })),
    }, timeoutMs);

  const before = o.state && !['probe', 'find', 'eval'].includes(cmd) ? await cdp.call(inPageState) : null;
  let hit = null;
  let result = { cmd, nums };

  if (cmd === 'eval') {
    const expr = o.strs.join(' ');
    if (!expr) {
      console.error('eval 需要一个表达式，例如: eval "window.visualViewport.scale"');
      return 2;
    }
    const value = await cdp.evaluate(expr);
    console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
    result = { ...result, expr, value };
  } else if (cmd === 'find') {
    const needle = o.strs[0] ?? '';
    if (!needle) {
      console.error('find 需要一个文字参数，例如: find 帮助');
      return 2;
    }
    const list = await cdp.call(inPageFind, needle, o.exact);
    console.log(`▸ 含「${needle}」的叶子元素 ${list.length} 个：`);
    if (!list.length) console.log('  （没有）');
    console.log(`  ${'控件'.padEnd(26)}${'文字'.padEnd(20)}${'中心点'.padEnd(18)}${'rect'.padEnd(26)}可点`);
    for (const e of list) {
      console.log(
        `  ${e.sel.slice(0, 25).padEnd(26)}${e.text.slice(0, 19).padEnd(20)}` +
          `${String(`(${e.center[0]},${e.center[1]})`).padEnd(18)}` +
          `${String(`${e.rect.w}×${e.rect.h} @${e.rect.x},${e.rect.y}`).padEnd(26)}${e.clickable ? '✅' : '🔴'}`,
      );
    }
    result = { ...result, needle, list };
  } else if (cmd === 'probe') {
    hit = await cdp.call(inPageHit, nums[0], nums[1]);
    console.log(`▸ 命中: ${hit ? `${hit.tag}  “${hit.text}”  rect=${JSON.stringify(hit.rect)}  cursor=${hit.cursor}` : '（落空，elementFromPoint 返回 null）'}`);
    if (hit) console.log(`   祖先链: ${hit.chain.join(' ← ')}`);
    if (hit) {
      console.log(`   最近处理器宿主: ${hit.handlerOwner ? `${hit.handlerOwner.sel}（“${hit.handlerOwner.text}”）` : '（向上找不到 onClick/onPointerDown —— canvas 类交互属于正常）'}`);
      console.log(`   ${hit.interactive ? '✅ 这一下点得到' : '🔴 点不到：既非语义化可交互元素，冒泡链上也没有处理器'}`);
    }
    result = { ...result, x: nums[0], y: nums[1], hit };
  } else if (cmd === 'tap') {
    const [x, y] = nums;
    hit = await cdp.call(inPageHit, x, y);
    await touch('touchStart', [{ x, y }]);
    await sleep(o.hold);
    await touch('touchEnd', []);
    result = { ...result, x, y, hit };
  } else if (cmd === 'swipe') {
    const [x1, y1, x2, y2, dur = 300] = nums;
    const n = Math.max(2, o.steps);
    await touch('touchStart', [{ x: x1, y: y1 }]);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      await touch('touchMove', [{ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }]);
      await sleep(dur / n);
    }
    await touch('touchEnd', []);
    result = { ...result, from: [x1, y1], to: [x2, y2], dur };
  } else if (cmd === 'pinch') {
    const [cx, cy, r1, r2, dur = 400] = nums;
    const n = Math.max(2, o.steps);
    const pts = (r) => [{ id: 1, x: cx - r, y: cy }, { id: 2, x: cx + r, y: cy }];
    await touch('touchStart', pts(r1));
    for (let i = 1; i <= n; i++) {
      await touch('touchMove', pts(r1 + (r2 - r1) * (i / n)));
      await sleep(dur / n);
    }
    await touch('touchEnd', []);
    result = { ...result, center: [cx, cy], r1, r2, dur };
  } else if (cmd === 'pan2') {
    const [cx, cy, dx, dy, dur = 400] = nums;
    const n = Math.max(2, o.steps);
    const gap = 60; // 两指水平间距的一半
    const pts = (k) => [
      { id: 1, x: cx - gap + dx * k, y: cy + dy * k },
      { id: 2, x: cx + gap + dx * k, y: cy + dy * k },
    ];
    await touch('touchStart', pts(0));
    for (let i = 1; i <= n; i++) {
      await touch('touchMove', pts(i / n));
      await sleep(dur / n);
    }
    await touch('touchEnd', []);
    result = { ...result, center: [cx, cy], delta: [dx, dy], dur };
  }

  if (before) {
    await sleep(250); // 给 React 一帧；再读一次状态
    const after = await cdp.call(inPageState);
    result = { ...result, before, after };
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    console.log(`\n▸ 状态摘要（前 → 后）${changed ? '✅ 有变化' : '⚠️ 完全没变 —— 这次操作可能没生效/没命中'}`);
    console.log(`   active: ${before.active} → ${after.active}`);
    console.log(`   selected: ${JSON.stringify(before.selected)} → ${JSON.stringify(after.selected)}`);
    console.log(`   inputs:   ${JSON.stringify(before.inputs)} → ${JSON.stringify(after.inputs)}`);
    console.log(`   texts:    ${JSON.stringify(before.texts)} → ${JSON.stringify(after.texts)}`);
    console.log(`   bodyLen:  ${before.bodyLen} → ${after.bodyLen}`);
  }

  if (cmd === 'tap' && hit && !hit.interactive) {
    console.log('\n🔴 命中点不在可交互元素内 —— 按 docs/05 §8.5 的判据，这项「点得到」不通过。');
  }

  if (o.json) {
    writeFileSync(o.json, JSON.stringify(result, null, 2));
    console.log(`\n▸ 结果 → ${o.json}`);
  }
  cdp.close();
  return 0;
}

process.exit(await main().catch((e) => {
  console.error(`❌ ${e.message}`);
  return 2;
}));
