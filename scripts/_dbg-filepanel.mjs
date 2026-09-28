import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const open = (name) => cdp.call(async (t) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const trig = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '视图');
  trig && trig.click(); await wait(800);
  const item = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === t || (x.textContent||'').trim() === t) && x.children.length <= 3);
  if (!item) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'no-item'; }
  const was = item.getAttribute('aria-checked');
  item.click(); await wait(2200);
  return 'clicked(wasChecked=' + was + ')';
}, name);
console.log('打开文件浏览器: ' + JSON.stringify(await open('文件浏览器')));
const dump = await cdp.call(() => {
  const handles = [...document.querySelectorAll('[data-hs-split-handle]')].map((e) => e.getAttribute('data-hs-split-handle'));
  // 文件面板根：含「刷新/文件夹/路径」那一片
  const cand = [...document.querySelectorAll('div')].filter((d) => /文件夹|路径|上级|授权|空|无文件|导入|\.wav|\.mp3/i.test(d.textContent||'') && d.children.length < 30);
  const leaf = cand[cand.length - 1];
  const rows = [...document.querySelectorAll('[data-hs-file-item],[role="option"],[role="listitem"]')].map((e) => (e.textContent||'').trim().slice(0,50));
  return {
    handles,
    panelText: leaf ? (leaf.textContent||'').replace(/\s+/g,' ').slice(0, 420) : '(未找到)',
    rowsCount: rows.length, rows: rows.slice(0, 10),
    fileButtons: [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || (b.textContent||'').trim()).slice(0,20)).filter((x) => /文件夹|刷新|上级|导入|路径|选择|授权|SAF|根/.test(x)),
  };
});
console.log(JSON.stringify(dump, null, 1));
cdp.close();
