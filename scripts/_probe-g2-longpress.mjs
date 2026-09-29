import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, d) => console.log(`${ok ? "✅" : "🔴"} ${n}\n     ${d}`);
// 打开 ^ 浮层
const opened = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.ariaLabel || "") === "更多开关");
  if (!t) return false;
  t.click(); await wait(1200); return true;
});
console.log("^ 浮层已开=" + opened);
// 长按「吸附网格…」
const grid = await cdp.call(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith("吸附网格"));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (grid) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: grid.x, y: grid.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(420);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1600);
}
const snapDlg = await cdp.call(() => {
  const dlg = document.querySelector("[role=dialog]");
  const txt = dlg ? (dlg.innerText || "").replace(/\s+/g, " ") : "";
  return { open: Boolean(dlg), head: txt.slice(0, 90), isGrid: /网格|吸附/.test(txt), isProject: /工程名|撤销历史/.test(txt) };
});
console.log("长按吸附网格 ⇒ " + JSON.stringify(snapDlg));
check("G-2a 长按「吸附网格…」打开**吸附网格设置**（不是工程设置）", snapDlg.open && snapDlg.isGrid && !snapDlg.isProject, JSON.stringify(snapDlg));
cdp.close();
