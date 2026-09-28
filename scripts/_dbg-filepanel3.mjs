import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const open = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '视图');
  t && t.click(); await wait(800);
  const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === '文件浏览器' || (x.textContent||'').trim() === '文件浏览器') && x.children.length <= 3);
  if (!it) return 'no-item'; it.click(); await wait(2500); return 'ok';
});
console.log('打开文件浏览器: ' + open);
const dump = await cdp.call(() => {
  const h = document.querySelector('[data-hs-split-handle="files"]');
  if (!h) return { error: 'no-panel' };
  let root = h;
  for (let i = 0; i < 8 && root.parentElement; i++) { root = root.parentElement; if (root.getBoundingClientRect().height > 150) break; }
  const rows = [...root.querySelectorAll('div,li,tr')].filter((e) => {
    const txt = (e.innerText||'').trim();
    return txt && txt.length < 60 && e.children.length <= 4 && /\.(wav|mp3|flac|m4a|aac|ogg|mp4|mkv|mov)/i.test(txt);
  }).map((e) => (e.innerText||'').trim().slice(0,40));
  return {
    rootText: (root.innerText||'').replace(/\s+/g,' ').slice(0, 500),
    fileRows: rows.slice(0, 12),
    buttons: [...root.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label')||(b.textContent||'').trim()).slice(0,24)).filter(Boolean),
    errorish: (root.innerText||'').match(/失败|错误|授权|无法|没有|空/g) || [],
  };
});
console.log(JSON.stringify(dump, null, 1));
cdp.close();
