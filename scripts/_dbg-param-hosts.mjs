import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ① 列出参数区域的宿主元素
const hosts = await cdp.call(() => {

  const attrs = [...document.querySelectorAll("*")]
    .flatMap((el) => [...el.attributes].filter((a) => a.name.startsWith("data-hs-")).map((a) => ({ el, name: a.name, value: a.value })))
    .map((x) => {
      const r = x.el.getBoundingClientRect();
      return { attr: x.name + (x.value ? "=" + x.value : ""), tag: x.el.tagName, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    })
    .filter((x) => x.rect[2] > 60 && x.rect[3] > 60);
  const seen = new Set();
  const uniq = attrs.filter((x) => { const k = x.attr + x.rect.join(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { count: uniq.length, list: uniq.slice(0, 22), canvases: [...document.querySelectorAll("canvas")].map((c) => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), cls: String(c.className || "").slice(0, 24), parentAttr: [...(c.parentElement?.attributes || [])].filter((a) => a.name.startsWith("data-hs-")).map((a) => a.name).join(",") }; }) };
});
console.log("宿主候选：" + JSON.stringify(hosts, null, 1).slice(0, 1400));
cdp.close();
