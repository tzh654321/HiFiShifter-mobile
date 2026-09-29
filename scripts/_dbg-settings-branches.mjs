import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = async () => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(500);
  await cdp.call(() => { document.querySelector("[data-hs-metronome-backdrop]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await sleep(700);
};
const fire = async (which) => {
  await cdp.call((w) => window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: w } })), which);
  await sleep(1600);
  return cdp.call(() => {
    const d = document.querySelector("[role=dialog]");
    return { open: Boolean(d), text: d ? (d.innerText || "").replace(/\s+/g, " ").slice(0, 120) : "" };
  });
};
const grid = await fire("snap-grid");
console.log("snap-grid ⇒ " + JSON.stringify(grid));
console.log((grid.open && /网格/.test(grid.text)) ? "✅ G-2a 吸附网格设置可打开" : "🔴 G-2a");
await esc();
const split = await fire("split-transition");
console.log("split-transition ⇒ " + JSON.stringify(split));
console.log((split.open && /过渡|交叉|淡化|形状/.test(split.text)) ? "✅ G-2b 分割过渡设置可打开" : "🔴 G-2b（内容不含预期关键词）");
await esc();
const mn = await fire("metronome");
console.log("metronome ⇒ " + JSON.stringify(mn));
console.log((mn.open && /细分/.test(mn.text)) ? "✅ H 节拍器菜单可打开" : "🔴 H");
await esc();
cdp.close();
