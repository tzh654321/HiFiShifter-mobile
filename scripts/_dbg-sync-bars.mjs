import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
// 打开参数面板（分屏）
const ready = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clickText = async (t) => { const el = [...document.querySelectorAll('button,[role="menuitem"],div')].find((b) => (b.textContent||'').trim() === t && b.children.length <= 3); if (el) { el.click(); return true; } return false; };
  if (document.querySelector('.hs-param-rows')) return 'already';
  await clickText('视图'); await wait(700); await clickText('参数面板'); await wait(1800);
  return document.querySelector('.hs-param-rows') ? 'opened' : 'missing';
});
console.log("参数面板:", ready);
const dump = () => cdp.call(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const sb = [...document.querySelectorAll('[class*="sb-h"]')].map((e) => ({ cls: e.className.toString().slice(0, 40), vis: vis(e), rect: [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)] }));
  const rulers = [...document.querySelectorAll('[data-hs-ruler], [class*="ruler"], [class*="Ruler"]')].map((e) => ({ cls: (e.className||'').toString().slice(0, 40), vis: vis(e), top: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height) }));
  // 同步开关的真值
  const syncCb = [...document.querySelectorAll('input[type="checkbox"], [role="switch"], button[aria-checked]')].map((e) => ({ label: (e.getAttribute('aria-label')||e.closest('label')?.textContent||'').trim().slice(0, 24), checked: e.checked ?? e.getAttribute('aria-checked') }));
  return { 可见滑动条: sb.filter((x) => x.vis).length, 滑动条: sb, 可见拍数栏: rulers.filter((x) => x.vis).length, 拍数栏: rulers, 开关: syncCb.slice(0, 10) };
});
console.log(JSON.stringify(await dump(), null, 1));
cdp.close();
