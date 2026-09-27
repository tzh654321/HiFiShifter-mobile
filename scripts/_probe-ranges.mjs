/**
 * 探针：参数界面里的 range 滑条（`input.qt-range`）到底能不能拖。
 *
 * 背景：用户报「参数界面滑条划动也只能小幅划动，要改」。上一轮把它理解成自绘滚动条
 * （实测滚动条拖拽正常 Δ1095），但排版审计在平板上量到 `input.qt-range` **高仅 14px
 * 且中心点被别的元素挡住** —— 这才是"只能小幅划动"的候选根因，本轮查清。
 *
 * 输出每条滑条：位置尺寸、touch-action、被谁挡住、以及**直接设 value 后能否触发
 * React 的 onChange**（能则说明是纯遮挡问题）。
 */
import { Cdp } from './lib/cdp.mjs';

const port = Number(process.env.PORT || 9222);
const cdp = await Cdp.attach({ port });
await cdp.send('Runtime.enable');

const expr = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return [ +b.left.toFixed(1), +b.top.toFixed(1), +b.width.toFixed(1), +b.height.toFixed(1) ]; };
  const ranges = [...document.querySelectorAll('input[type=range], .qt-range')];
  return ranges.map((e) => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    // 沿滑条宽度逐点采样：多少比例的点真的命中滑条自己（= 用户拖得到的范围）
    const N = 24;
    const y = b.top + b.height / 2;
    let hitSelf = 0;
    const losers = [];
    for (let i = 0; i < N; i++) {
      const x = b.left + ((i + 0.5) / N) * b.width;
      const hit = document.elementFromPoint(x, y);
      if (hit === e || e.contains(hit)) hitSelf++;
      else if (losers.length < 3) losers.push({ x: Math.round(x), by: hit ? (hit.id || String(hit.className).slice(0, 34)) : 'null' });
    }
    return {
      name: e.getAttribute('aria-label') || e.getAttribute('data-name') || (e.parentElement?.innerText || '').split('\\n')[0].slice(0, 12),
      rect: R(e),
      visible: !!e.offsetParent,
      min: e.min, max: e.max, value: e.value,
      touchAction: cs.touchAction,
      hittablePx: +((hitSelf / N) * b.width).toFixed(1),
      hittableRatio: +(hitSelf / N).toFixed(2),
      sampleLosers: losers,
    };
  });
})()`;

const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(res.result.value, null, 1));
cdp.close();
