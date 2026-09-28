import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const dump = await cdp.call(() => {
  const h = document.querySelector('[data-hs-split-handle="files"]');
  if (!h) return { error: 'no-files-handle' };
  // 手柄所在面板的根：向上找到第一个「块级」祖先（高度 > 200）
  let root = h;
  for (let i = 0; i < 6 && root.parentElement; i++) {
    root = root.parentElement;
    if (root.getBoundingClientRect().height > 200) break;
  }
  const r = root.getBoundingClientRect();
  const html = root.outerHTML;
  return {
    rootTag: root.tagName + '.' + (root.className||'').toString().slice(0, 60),
    rootRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    innerText: (root.innerText||'').replace(/\s+/g,' ').slice(0, 400),
    childCount: root.children.length,
    buttons: [...root.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label')||(b.textContent||'').trim()).slice(0,24)),
    listLike: [...root.querySelectorAll('[role],[class*=list],[class*=row],[class*=item]')].slice(0, 14).map((e) => ({ tag: e.tagName, role: e.getAttribute('role'), cls: (e.className||'').toString().slice(0,40) })),
    htmlHead: html.slice(0, 300),
  };
});
console.log(JSON.stringify(dump, null, 1));
cdp.close();
