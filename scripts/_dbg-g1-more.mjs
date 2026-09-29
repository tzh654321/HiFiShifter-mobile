import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = () => cdp.call(() => {
  const bar = document.querySelector("[data-hs-clip-actions]");
  if (!bar) return { exists: false };
  const inner = bar.querySelector("div");
  const btns = [...(inner ? inner.querySelectorAll("button,[role=button]") : [])].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      text: (b.innerText || "").trim().slice(0, 8),
      aria: (b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || "").slice(0, 10),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
    };
  });
  return { exists: true, innerRect: inner ? [Math.round(inner.getBoundingClientRect().left), Math.round(inner.getBoundingClientRect().top), Math.round(inner.getBoundingClientRect().width)] : null, buttons: btns };
});
console.log("浮条按钮：" + JSON.stringify(await dump()));
const last = await cdp.call(() => {
  const bar = document.querySelector("[data-hs-clip-actions]");
  const inner = bar?.querySelector("div");
  const btns = inner ? [...inner.querySelectorAll("button,[role=button]")] : [];
  const b = btns[btns.length - 1];
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (b.innerText || "").trim() };
});
console.log("最后一个按钮：" + JSON.stringify(last));
if (last) {
  await cdp.call((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    const b = el && el.closest ? el.closest("button,[role=button]") : null;
    (b ?? el)?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, last);
  await sleep(1600);
  const menu = await cdp.call(() => {
    const el = [...document.querySelectorAll("div")].find((d) => {
      const t = d.innerText || "";
      const r = d.getBoundingClientRect();
      return /重命名/.test(t) && /删除|静音/.test(t) && r.height > 60 && r.height < 800;
    });
    return { present: Boolean(el), sample: el ? (el.innerText || "").replace(/\s+/g, " ").slice(0, 90) : null };
  });
  console.log("点最后一个按钮后 ⇒ " + JSON.stringify(menu));
}
cdp.close();
