import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = document.querySelector('[data-hs-mobile-split]');
  const el = document.querySelector('[data-hs-time-ruler="params"]');
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + 30), y0 = Math.round(r.top + r.height / 2);
  const grows = () => [...c.children].map((k) => +getComputedStyle(k).flexGrow);
  const hts = () => [...c.children].map((k) => Math.round(k.getBoundingClientRect().height));
  const mk = (type, y, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 51, isPrimary: true, button: type === 'pointerdown' ? 0 : -1, buttons, clientX: x, clientY: y });
  const log = [{ tag: 'before', grows: grows(), hts: hts() }];
  el.dispatchEvent(mk('pointerdown', y0, 1));
  await wait(80);
  log.push({ tag: 'down', grows: grows(), hts: hts() });
  for (let i = 1; i <= 6; i++) {
    window.dispatchEvent(mk('pointermove', y0 + 20 * i, 1));
    await wait(60);
    log.push({ tag: 'move+' + 20 * i, grows: grows(), hts: hts() });
  }
  window.dispatchEvent(mk('pointerup', y0 + 120, 0));
  await wait(400);
  log.push({ tag: 'up', grows: grows(), hts: hts() });
  return { start: [x, y0], log, childCount: c.children.length };
});
console.log(JSON.stringify(out, null, 1));
cdp.close();
