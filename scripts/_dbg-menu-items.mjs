import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (x, y) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x, y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
};
const trig = await cdp.call(() => {
  const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "文件");
  if (!b) return { found: false, btns: btns.slice(0, 12) };
  const r = b.getBoundingClientRect();
  return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log("文件按钮：" + JSON.stringify(trig));
if (trig.found) {
  await tap(trig.x, trig.y);
  const dump = await cdp.call(() => {
    const items = [...document.querySelectorAll("[role=menuitem]")].map((x) => ({
      text: (x.textContent || "").trim().slice(0, 14),
      attrs: [...x.attributes].map((a) => a.name).filter((n) => n.startsWith("data-")).join(","),
    }));
    return { count: items.length, items: items.slice(0, 14) };
  });
  console.log("文件菜单项：" + JSON.stringify(dump, null, 0).slice(0, 900));
}
cdp.close();
