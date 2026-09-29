import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (n, ok, d) => console.log(`${ok ? "✅" : "🔴"} ${n}${d ? "\n     " + d : ""}`);
const dialogText = () => cdp.call(() => {
  const d = document.querySelector("[role=dialog]");
  return d ? (d.innerText || "").replace(/\s+/g, " ").slice(0, 90) : null;
});
const esc = async () => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(400);
  await cdp.call(() => document.querySelectorAll("[data-hs-metronome-backdrop],[data-hs-project-backdrop]").forEach((b) => b.dispatchEvent(new MouseEvent("click", { bubbles: true }))));
  await sleep(600);
};
/** 打开 ^ 浮层（底栏"更多开关"） */
const openFold = async () => {
  await cdp.call(() => {
    const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.getAttribute("aria-label") || "") === "更多开关");
    t?.click();
  });
  await sleep(1200);
};
/** 长按某项（合成 pointerdown + 260ms + pointerup） */
const longPress = async (prefix) => {
  const box = await cdp.call((pfx) => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith(pfx));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, prefix);
  if (!box) return false;
  await cdp.call(async (x, y) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 81, isPrimary: true, clientX: x, clientY: y, button: 0 });
    const el = document.elementFromPoint(x, y) ?? document.body;
    el.dispatchEvent(ev("pointerdown"));
    await wait(420);
    el.dispatchEvent(ev("pointerup"));
    await wait(300);
  }, box.x, box.y);
  await sleep(1400);
  return true;
};
for (const [prefix, expect] of [["吸附网格", /网格/], ["分割过渡", /过渡|交叉|淡化/], ["节拍器", /细分|音量/]]) {
  await esc();
  await sleep(600);
  await openFold();
  /* 确认 ^ 浮层里的目标项**真的可见**（前一个对话框没关时浮层打不开 ⇒ 长按会打空）。 */
  const visible = await cdp.call((pfx) => {
    const el = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith(pfx));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }, prefix);
  if (!visible) {
    await openFold();
    await sleep(800);
  }
  const ok = await longPress(prefix);
  const txt = await dialogText();
  check(`F2 长按「${prefix}…」⇒ 打开对应设置`, ok && txt !== null && expect.test(txt), `对话框=${JSON.stringify(txt)}`);
}
await esc();
cdp.close();
