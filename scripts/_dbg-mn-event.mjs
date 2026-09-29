import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ① 直接派发事件（绕过长按）
const r1 = await cdp.call(async () => {
  window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: "metronome" } }));
  await new Promise((r) => setTimeout(r, 1500));
  const d = document.querySelector("[data-hs-metronome-settings]");
  return { open: Boolean(d), text: d ? (d.innerText || "").replace(/\s+/g, " ").slice(0, 120) : "" };
});
console.log("① 直接派发事件 ⇒ " + JSON.stringify(r1));
// ② 检查 ^ 菜单里节拍器按钮是否真的有 longPress（点它看是否只切换开关）
await cdp.call(() => { document.querySelector("[data-hs-metronome-backdrop]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await sleep(600);
const r2 = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.ariaLabel || "") === "更多开关");
  t?.click(); await wait(1200);
  const labels = [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()).filter((s) => s.length > 1 && s.length < 10);
  return { labels: labels.slice(0, 16) };
});
console.log("② ^ 菜单文案 ⇒ " + JSON.stringify(r2));
cdp.close();
