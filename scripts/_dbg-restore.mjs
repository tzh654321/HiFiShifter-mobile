import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = process.argv[2] ?? "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
try { await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); } catch {}
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ id: p.id ?? i, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 })) });
// 绘制按钮位置
const box = await cdp.call(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('data-tooltip') || '') === '绘制');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log("绘制按钮:", JSON.stringify(box));
if (!box) { cdp.close(); process.exit(0); }
await touch("touchStart", [{ id: 0, x: box.x, y: box.y }]);
await sleep(700);
await touch("touchEnd", []);
await sleep(700);
const menu = await cdp.call(() => {
  const items = [...document.querySelectorAll('[role="menuitem"],button')]
    .map((b) => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 12), top: Math.round(b.getBoundingClientRect().top) }))
    .filter((x) => x.label && x.top > 40 && x.top < 400);
  return items.slice(0, 24);
});
console.log("菜单候选:", JSON.stringify(menu));
cdp.close();
