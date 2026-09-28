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
  // 用"上一级"按钮走到授权目录之外 ⇒ needsAuth 变 true ⇒ 提示条出现
  for (let i = 0; i < 3; i++) {
    const up = [...document.querySelectorAll('button')].find((b) => /上一级|上级|parent/i.test(b.getAttribute('data-tooltip') || b.ariaLabel || ''));
    if (!up) break;
    up.click();
    await wait(1200);
    if (document.querySelector('[data-hs-needs-auth="1"]')) break;
  }
  const hint = document.querySelector('[data-hs-needs-auth="1"]');
  const r = hint ? hint.getBoundingClientRect() : null;
  const btns = hint ? [...hint.querySelectorAll('button')].map((b) => {
    const br = b.getBoundingClientRect();
    return { text: (b.textContent || '').trim(), rect: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)] };
  }) : [];
  const txt = hint ? hint.querySelector('span')?.getBoundingClientRect() : null;
  return {
    hintPresent: Boolean(hint),
    hintRect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
    textRect: txt ? [Math.round(txt.left), Math.round(txt.top), Math.round(txt.width), Math.round(txt.height)] : null,
    buttons: btns,
    overflowRight: btns.some((b) => b.rect[0] + b.rect[2] > 360),
  };
});
console.log(JSON.stringify(out, null, 1));
adb("exec-out screencap -p > docs/evidence/realdevice/hint-layout-fixed.png");
console.log("截图已存 docs/evidence/realdevice/hint-layout-fixed.png");
cdp.close();
