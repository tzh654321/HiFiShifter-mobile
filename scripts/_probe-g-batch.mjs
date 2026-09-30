import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = process.argv[2] ?? "emulator-5554"; /* 别硬编码真机序列号：模拟器上就跑不了 */
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, d) => console.log(`${ok ? "✅" : "🔴"} ${n}\n     ${d}`);
const longPress = async (labelStart) => {
  const b = await cdp.call((lb) => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith(lb));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, labelStart);
  if (!b) return false;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: b.x, y: b.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(420);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1500);
  return true;
};
const dlg = () => cdp.call(() => {
  const d = document.querySelector("[role=dialog]");
  return { open: Boolean(d), text: d ? (d.innerText || "").replace(/\s+/g, " ").slice(0, 130) : "" };
});
/* 关掉当前对话框：radix 的 Dialog 用 **Escape** 最可靠（它的 backdrop 没有我们的 data-* 属性；
   我的自绘浮层则点 backdrop）。两种都试一遍。 */
const closeDlg = async () => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(500);
  await cdp.call(() => {
    document.querySelector("[data-hs-project-backdrop],[data-hs-storage-backdrop]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(700);
};
// 打开 ^ 浮层
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.ariaLabel || "") === "更多开关");
  t?.click(); await wait(1200);
});
// ① 长按吸附网格 ⇒ 吸附网格设置
await longPress("吸附网格");
const a = await dlg();
check("G-2a 长按「吸附网格…」⇒ 原版吸附/网格设置（不是工程设置）", a.open && /网格/.test(a.text) && !/工程名/.test(a.text), JSON.stringify(a));
await closeDlg();
// ② 长按分割过渡 ⇒ 分割过渡设置
await cdp.call(() => { const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.ariaLabel || "") === "更多开关"); if (!document.querySelector("[role=dialog]")) t?.click(); });
await sleep(1200);
await longPress("分割过渡");
const b2 = await dlg();
check("G-2b 长按「分割过渡…」⇒ 分割过渡设置", b2.open && /过渡|交叉|淡化/.test(b2.text), JSON.stringify(b2));
await closeDlg();
// ③ 长按别的项（例如节拍器）⇒ 不应进工程设置
await cdp.call(() => { const t = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("data-tooltip") || x.ariaLabel || "") === "更多开关"); t?.click(); });
await sleep(1200);
await longPress("节拍器");
const c3 = await dlg();
check("G-2c 长按无长按菜单的项（节拍器）⇒ **不**打开工程设置", !c3.open || !/工程名/.test(c3.text), JSON.stringify(c3));
await closeDlg();
cdp.close();
