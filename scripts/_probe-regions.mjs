/**
 * 布局区域探针：报告三套布局下各主要面板的矩形，用于判断结构是否正确。
 *
 * 输出：视口、以及按"语义名"找出的面板矩形（菜单栏 / 工具栏 / 时间线 / 参数面板 /
 * 侧栏 / 顶栏 / 底栏 / 状态栏 / 页签）。
 *
 * 找法不依赖固定 class（上游还会改），而是用「特征 + 尺寸」启发式，并打印实际 class
 * 以便人工核对。
 */
import { Cdp } from './lib/cdp.mjs';

const port = Number(process.env.PORT || 9222);
const cdp = await Cdp.attach({ port });
await cdp.send('Runtime.enable');

const expr = `(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const all = [...document.querySelectorAll('div,header,nav,aside,footer,canvas')];
  const vw = innerWidth, vh = innerHeight;
  const out = { vp: [vw, vh], dpr: devicePixelRatio, regions: {}, canvases: [], overflowX: document.documentElement.scrollWidth - vw };

  // 画布：时间线 / 钢琴卷帘 / 参数轴
  out.canvases = all.filter((e) => e.tagName === 'CANVAS').map((e) => ({ rect: R(e), cls: String(e.className).slice(0, 40) }));

  // 顶栏/底栏/状态栏：贴边且高度小的条
  const top = all.filter((e) => { const b = e.getBoundingClientRect(); return Math.round(b.top) === 0 && b.width > vw * 0.9 && b.height > 0 && b.height < 64; });
  const bottom = all.filter((e) => { const b = e.getBoundingClientRect(); return Math.round(b.bottom) >= vh - 2 && b.width > vw * 0.9 && b.height > 0 && b.height < 64; });
  out.regions.topBars = top.map((e) => ({ rect: R(e), h: Math.round(e.getBoundingClientRect().height), cls: String(e.className).slice(0, 50) }));
  out.regions.bottomBars = bottom.map((e) => ({ rect: R(e), h: Math.round(e.getBoundingClientRect().height), cls: String(e.className).slice(0, 50) }));

  // 侧栏：靠右、宽度 200–420、高度 > 40% 视口
  out.regions.rightPanels = all.filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width >= 200 && b.width <= 420 && b.height > vh * 0.4 && b.right > vw - 4;
  }).map((e) => ({ rect: R(e), cls: String(e.className).slice(0, 50) }));

  // 内容区：非画布的大块（宽度 > 40% 视口）
  out.regions.bigBlocks = all.filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > vw * 0.4 && b.height > vh * 0.3;
  }).map((e) => ({ rect: R(e), cls: String(e.className).slice(0, 60) })).slice(0, 14);
  return out;
})()`;

const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(res.result.value, null, 1));
cdp.close();
