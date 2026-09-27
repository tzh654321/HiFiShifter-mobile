/**
 * 一次性探针：平板视口下，"越界"的工具栏按钮到底够不够得着？
 *
 * 排版审计把它们报成 `offscreen` + `clipped`（最多越界 252px），但工具栏根节点带
 * `overflow-x-auto` —— 若真能横向滚动，那是审计**误报**（它的 clipped 判据只认
 * overflow:hidden/clip，认不出"可滚动祖先"），就不能据此改代码。
 *
 * 枚举所有 overflow-x 为 auto/scroll 的容器，给出：溢出量、能否设 scrollLeft、
 * 滚到底后最后一个按钮是否落回视口内。
 */
import { Cdp } from './lib/cdp.mjs';

const port = Number(process.env.PORT || 9222);
const cdp = await Cdp.attach({ port });
await cdp.send('Runtime.enable');

const expr = `(() => {
  const r2 = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const out = { vp: [innerWidth, innerHeight], dpr: devicePixelRatio, bars: [] };
  for (const e of document.querySelectorAll('div')) {
    const s = getComputedStyle(e);
    const horiz = s.overflowX === 'auto' || s.overflowX === 'scroll';
    if (!horiz) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 200 || b.height < 20) continue;
    const btns = [...e.querySelectorAll('button')];
    if (btns.length < 3) continue;
    const before = e.scrollLeft;
    e.scrollLeft = 999999;
    const maxScroll = Math.round(e.scrollLeft);
    e.scrollLeft = before;
    // 滚到底，看最后一个按钮回不回到容器里
    e.scrollLeft = 999999;
    const lb = btns[btns.length - 1].getBoundingClientRect();
    const eb = e.getBoundingClientRect();
    const reachable = lb.left >= eb.left - 2 && lb.right <= eb.right + 2;
    e.scrollLeft = before;
    out.bars.push({
      cls: String(e.className).slice(0, 60),
      rect: r2(e),
      overflowPx: e.scrollWidth - e.clientWidth,
      maxScrollLeft: maxScroll,
      touchAction: s.touchAction,
      buttons: btns.length,
      lastBtnReachableAfterScroll: reachable,
    });
  }
  return out;
})()`;

const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(res.result.value, null, 1));
cdp.close();
