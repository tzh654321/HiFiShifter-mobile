import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const out = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '视图');
  trig.click();
  await wait(1000);
  // 菜单弹出后：抓所有"新出现"的可点元素
  const items = [...document.querySelectorAll('[role], div, button')]
    .filter((el) => {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 24) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 14 || r.height > 60) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.top > 40;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      text: (el.textContent || '').trim().slice(0, 14),
      at: [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().top)],
      checked: el.getAttribute('aria-checked') || el.getAttribute('data-state') || '',
    }))
    .filter((x, i, arr) => arr.findIndex((y) => y.text === x.text && y.at[1] === x.at[1]) === i);
  return items.slice(0, 30);
});
console.log(JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{'));
cdp.close();
