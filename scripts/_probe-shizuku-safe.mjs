import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (document.querySelector('[data-hs-split-handle="files"]')) return;
  const t = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
  t && t.click(); await wait(900);
  const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === '文件浏览器' || (x.textContent||'').trim() === '文件浏览器') && x.children.length <= 3);
  it && it.click(); await wait(2600);
});
// 真触摸点 Shizuku 按钮
const box = await cdp.call(() => {
  const b = document.querySelector('[data-hs-shizuku]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), state: b.getAttribute('data-hs-shizuku'), text: (b.textContent||'').trim() };
});
console.log("按钮 = " + JSON.stringify(box));
if (box) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: box.x, y: box.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await new Promise((r) => setTimeout(r, 2500));
const hint = await cdp.call(() => {
  const h = document.querySelector('[data-hs-shizuku-hint="1"]');
  return { hintPresent: Boolean(h), hintText: h ? (h.innerText||'').slice(0, 80) : null };
});
console.log("提示 = " + JSON.stringify(hint));
cdp.close();
