#!/usr/bin/env node
/**
 * 排版审计 —— 把 `docs/05` §8.5 的「**看得到**」这一步变成可复跑的清单。
 *
 * 做法：经 CDP 在页面里量每个可交互元素的矩形，判四类问题：
 *
 *   1. `offscreen`  矩形超出视口，**且滚不回来** —— 用户根本看不到
 *   2. `clipped`    被**不可滚动**的祖先裁掉 —— 永远看不到
 *   3. `occluded`   中心点被别的元素挡住（`elementFromPoint` 命中别人）
 *   4. `tooSmall`   触摸目标 < 44 px（`docs/07` 的硬约束）
 *
 * 另附两类"不是 bug 但要知道"的信息：
 *   · `needScroll`  落在**可滚动**祖先之外 / 或超出视口但可滚回 —— 滚动可见，不算错
 *   · `needsTapArea` 命中点落回祖先而不落到自身（事件被父级接管，常见于整块可点区域）
 *
 * ⚠️ 判定要点（2026-09-20 修正，别再改回去）：`overflow-x: auto` + `overflow-y: hidden`
 * 的容器**是可滚动的**，其内部元素不算 clipped；只有「该方向不可滚 + overflow 为
 * hidden/clip」才判死。修正前 ActionBar 被误报 15 clipped + 9 offscreen。
 *
 * ⚠️ 已知边界：**画布（canvas/WebGL）里的交互对象量不出来**。时间线、钢琴卷帘都是
 * 画布渲染，DOM 里只有一个 `<canvas>`。那部分的「看得到 + 点得到」必须靠
 * `touch-drive.mjs` 派发触摸后观察状态变化，不能靠本脚本。
 *
 * 用法:
 *   node scripts/layout-audit.mjs [--port 9222] [--min-touch 44] [--json out.json] [--top 12]
 *
 * 前置：见 scripts/lib/cdp.mjs 顶部（adb forward tcp:9222 …）
 */
import { writeFileSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';

// ── 在页面里跑的审计（会被序列化后送进 WebView，不能引用外部变量）────────────
function inPageAudit(opts) {
  const { minTouch, selectorList, maxItems } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const TOL = 0.5;

  const txt = (el) =>
    (el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.innerText || '').trim() ||
      (el.value ?? '') + '' ||
      el.getAttribute('placeholder') ||
      '').trim().slice(0, 28);

  const describe = (el) => {
    const cls = (el.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => c && !/^(css-|sc-)/.test(c))
      .slice(0, 2)
      .join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };

  const visible = (el, cs, r) =>
    cs.display !== 'none' &&
    cs.visibility !== 'hidden' &&
    Number(cs.opacity) !== 0 &&
    r.width >= 1 &&
    r.height >= 1;

  // 祖先裁切 / 可滚动
  //
  // ⚠️ 2026-09-20 修正：旧判据只看「有没有 overflow:hidden/clip」就判死，于是
  // `overflow-x:auto` + `overflow-y:hidden` 的工具栏（ActionBar 根节点就是这个组合）
  // 被当成"永久裁切"——15 个靠右的按钮报 clipped、9 个报 offscreen，而实测它们
  // **滚一下就够得着**（overflowPx=256、maxScrollLeft=257、滚到底末个按钮落回容器内）。
  // 差一点据此去"修"一个不存在的 bug。
  //
  // 现在改成先问「这个方向能不能滚过去」：
  //   · 该方向可滚（scrollWidth/Height > client 尺寸）⇒ 归 needScroll（滚动可见，不算错）
  //   · 该方向不可滚 且 overflow 是 hidden/clip ⇒ 才是 clipped（真的永远看不到）
  // 并回传 reach，让"超出视口但滚得回去"的元素不再报 offscreen。
  const ancestorBox = (el, r) => {
    let p = el.parentElement;
    let clipped = null;
    let needScroll = null;
    const reach = { x: false, y: false };
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const hard = (v) => v === 'hidden' || v === 'clip';
      const soft = (v) => v === 'auto' || v === 'scroll';
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      const ar = p.getBoundingClientRect();
      const cut = {
        left: Math.max(0, ar.left - r.left),
        right: Math.max(0, r.right - ar.right),
        top: Math.max(0, ar.top - r.top),
        bottom: Math.max(0, r.bottom - ar.bottom),
      };
      const worst = Math.max(cut.left, cut.right, cut.top, cut.bottom);
      if (worst > 1) {
        const cutX = cut.left > 1 || cut.right > 1;
        const cutY = cut.top > 1 || cut.bottom > 1;
        const escX = cutX && (soft(ox) || hard(ox)) && p.scrollWidth > p.clientWidth + 1;
        const escY = cutY && (soft(oy) || hard(oy)) && p.scrollHeight > p.clientHeight + 1;
        // 内层祖先已经能把这个方向滚到位 ⇒ 外层再怎么裁都不算"死"
        // （典型：ActionBar 自己 overflow-x:auto 可滚，而根节点是 overflow-hidden，
        //   旧写法只按当前祖先逐个判断，于是这 9 个按钮仍被判 clipped。）
        const innerReachX = reach.x;
        const innerReachY = reach.y;
        if (escX) reach.x = true;
        if (escY) reach.y = true;
        const deadX = cutX && !escX && !innerReachX && hard(ox);
        const deadY = cutY && !escY && !innerReachY && hard(oy);
        if ((deadX || deadY) && !clipped) {
          clipped = { by: describe(p), cut, unescapable: { x: deadX, y: deadY } };
        } else if (!needScroll) {
          needScroll = { by: describe(p), cut };
        }
      }
      p = p.parentElement;
    }
    return { clipped, needScroll, reach };
  };

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(selectorList)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    const label = txt(el) || describe(el);
    const key = `${describe(el)}|${label}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const off = {
      left: Math.max(0, -r.left),
      top: Math.max(0, -r.top),
      right: Math.max(0, r.right - vw),
      bottom: Math.max(0, r.bottom - vh),
    };
    const offWorst = Math.max(off.left, off.top, off.right, off.bottom);

    // 命中测试（中心点）。中心点若已在视口外就跳过 —— 那属于 offscreen。
    let occluded = null;
    let needsTapArea = false;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    if (offWorst <= TOL) {
      const hit = document.elementFromPoint(cx, cy);
      if (hit) {
        if (!el.contains(hit) && hit !== el) {
          if (hit.contains(el)) needsTapArea = true;
          else occluded = { by: describe(hit), text: txt(hit).slice(0, 20) };
        }
      }
    }

    const { clipped, needScroll, reach } = ancestorBox(el, r);

    // 触摸目标：不能只看 `getBoundingClientRect()`。
    // docs/04 §5 的 hitbox 解耦做法（`::after { inset: -12px }`）在
    // `elementFromPoint` 上会命中**宿主元素本身**（伪元素不参与 elementFromPoint 返回），
    // 所以可以从中心向外扫描，量出**真实命中区**。否则明明已经外扩到 44px 的图标按钮
    // 会被一直算作 tooSmall（2026-09-20：平板上 57 条里有一半属于这种误报）。
    const hitExtent = (axis) => {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const limit = Math.min(minTouch + 12, axis === 'x' ? vw : vh);
        const self = (d) => {
            const x = axis === 'x' ? cx + d : cx;
            const y = axis === 'x' ? cy : cy + d;
            if (x < 0 || y < 0 || x > vw - 1 || y > vh - 1) return false;
            const h = document.elementFromPoint(x, y);
            return h === el || el.contains(h);
        };
        let pos = Math.floor(r[axis === 'x' ? 'width' : 'height'] / 2);
        let neg = pos;
        for (let d = pos + 1; d <= limit; d++) {
            if (self(d)) pos = d;
            else break;
        }
        for (let d = neg + 1; d <= limit; d++) {
            if (self(-d)) neg = d;
            else break;
        }
        return pos + neg + 1;
    };
    let tooSmall = r.width < minTouch || r.height < minTouch;
    let hitBox = null;
    if (tooSmall) {
        const effW = r.width < minTouch ? +hitExtent('x').toFixed(0) : +r.width.toFixed(0);
        const effH = r.height < minTouch ? +hitExtent('y').toFixed(0) : +r.height.toFixed(0);
        hitBox = { w: effW, h: effH };
        if (effW >= minTouch && effH >= minTouch) {
            tooSmall = false; // 视觉尺寸小，但命中区达标 ⇒ 不算问题
        }
    }

    // 「越界」也要看能不能滚回来：在某方向超出视口、而该方向的祖先可滚 ⇒ 用户划一下
    // 就能看到，不算 offscreen（记进 needScroll）。否则会像 ActionBar 那样一次误报 9 条。
    const cutX = off.left > TOL || off.right > TOL;
    const cutY = off.top > TOL || off.bottom > TOL;
    const offEscapable = offWorst > TOL && (!cutX || reach.x) && (!cutY || reach.y);

    out.push({
      sel: describe(el),
      label,
      rect: { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      flags: {
        ...(offWorst > TOL && !offEscapable ? { offscreen: { ...off, worst: +offWorst.toFixed(1) } } : {}),
        ...(clipped ? { clipped } : {}),
        ...(occluded ? { occluded } : {}),
        ...(tooSmall ? { tooSmall: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), hit: hitBox } } : {}),
        ...(needScroll || offEscapable ? { needScroll: needScroll ?? { by: '视口', cut: { left: off.left, right: off.right, top: off.top, bottom: off.bottom } } } : {}),
        ...(needsTapArea ? { needsTapArea } : {}),
      },
    });
  }

  out.sort((a, b) => {
    const sev = (o) => (o.flags.offscreen ? 1000 + o.flags.offscreen.worst : 0) + (o.flags.clipped ? 500 : 0) + (o.flags.occluded ? 300 : 0) + (o.flags.tooSmall ? 100 : 0);
    return sev(b) - sev(a);
  });

  return {
    viewport: { w: vw, h: vh, dpr },
    url: location.href,
    total: out.length,
    items: out.slice(0, maxItems),
    truncated: Math.max(0, out.length - maxItems),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function parseArgs(argv) {
  const o = { port: 9222, host: '127.0.0.1', minTouch: 44, top: 12, json: null, maxItems: 4000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--min-touch') o.minTouch = Number(argv[++i]);
    else if (a === '--top') o.top = Number(argv[++i]);
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--max-items') o.maxItems = Number(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    console.log('用法: node scripts/layout-audit.mjs [--port 9222] [--min-touch 44] [--json out.json] [--top 12]');
    return 0;
  }

  return (async () => {
    const cdp = await Cdp.attach({ host: opt.host, port: opt.port });
    console.log(`▸ 目标: ${cdp.page.url}  (${cdp.page.title || 'no title'})`);

    await cdp.send('Runtime.enable');
    const res = await cdp.call(inPageAudit, { minTouch: opt.minTouch, selectorList: SELECTORS, maxItems: opt.maxItems });

    const { viewport, items, total, truncated } = res;
    const cnt = (f) => items.filter((i) => f(i.flags)).length;

    console.log(`▸ 视口: ${viewport.w}×${viewport.h} CSS px  (dpr ${viewport.dpr})`);
    console.log(`▸ 可交互元素（可见）: ${total}${truncated ? `（另有 ${truncated} 个未纳入报告）` : ''}`);
    console.log('');
    console.log('  类别            数量   说明');
    console.log('  ─────────────  ────  ────────────────────────────────────────────');
    console.log(`  offscreen      ${num(cnt((f) => f.offscreen), 4)}  超出视口，看不到`);
    console.log(`  clipped        ${num(cnt((f) => f.clipped), 4)}  被不滚动的祖先裁掉，永远看不到`);
    console.log(`  occluded       ${num(cnt((f) => f.occluded), 4)}  中心点被别的元素挡住`);
    console.log(`  tooSmall       ${num(cnt((f) => f.tooSmall), 4)}  触摸目标 < ${opt.minTouch} px`);
    console.log(`  needScroll     ${num(cnt((f) => f.needScroll), 4)}  落在可滚动祖先之外（滚动可见，非错）`);
    console.log(`  needsTapArea   ${num(cnt((f) => f.needsTapArea), 4)}  命中点落回祖先（事件被父级接管）`);

    const groups = [
      ['offscreen', '超出视口', (i) => i.flags.offscreen],
      ['clipped', '被裁切', (i) => i.flags.clipped],
      ['occluded', '被遮挡', (i) => i.flags.occluded],
      ['tooSmall', `触摸目标 < ${opt.minTouch}px`, (i) => i.flags.tooSmall],
    ];
    for (const [name, title, pred] of groups) {
      const list = items.filter(pred).slice(0, opt.top);
      if (!list.length) continue;
      console.log(`\n▸ ${title}（${name}，前 ${list.length} 条）`);
      console.log(`  ${pad('控件', 38)}${pad('文字', 22)}${num('x', 7)}${num('y', 7)}${num('w', 7)}${num('h', 7)}  详情`);
      for (const i of list) {
        const f = i.flags;
        // 一个元素可能同时踩多个坑，全部列出来（早先只显示第一个，会把裁切信息藏掉）
        const reasons = [];
        if (f.offscreen) reasons.push(`越界 ${f.offscreen.worst}px`);
        if (f.clipped) reasons.push(`被 ${f.clipped.by} 裁 ${Math.max(...Object.values(f.clipped.cut)).toFixed(0)}px`);
        if (f.occluded) reasons.push(`被 ${f.occluded.by} 挡住`);
        if (f.tooSmall) {
            const hb = f.tooSmall.hit;
            reasons.push(
                hb
                    ? `${f.tooSmall.w}×${f.tooSmall.h}（命中区 ${hb.w}×${hb.h}）`
                    : `${f.tooSmall.w}×${f.tooSmall.h}`,
            );
        }
        console.log(
          `  ${pad(i.sel.slice(0, 37), 38)}${pad(i.label.slice(0, 21), 22)}` +
            `${num(i.rect.x, 7)}${num(i.rect.y, 7)}${num(i.rect.w, 7)}${num(i.rect.h, 7)}  ${reasons.join('；')}`,
        );
      }
    }

    if (opt.json) {
      writeFileSync(opt.json, JSON.stringify(res, null, 2));
      console.log(`\n▸ 完整结果 → ${opt.json}`);
    }

    const bad = cnt((f) => f.offscreen) + cnt((f) => f.clipped);
    console.log(`\n▸ 结论：${bad === 0 ? '✅ 没有被视口/祖先裁掉的可交互元素' : `🔴 ${bad} 个元素看不到`}`);
    cdp.close();
    return bad === 0 ? 0 : 1;
  })().catch((e) => {
    console.error(`❌ ${e.message}`);
    return 2;
  });
}

process.exit(await main());
