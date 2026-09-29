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
const longPress = async (lb) => {
  const b = await cdp.call((x) => {
    const el = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim().startsWith(x));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, lb);
  if (!b) return false;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 0, x: b.x, y: b.y, radiusX: 6, radiusY: 6, force: 1 }] });
  await sleep(420);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1500);
  return true;
};
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("data-tooltip") || b.ariaLabel || "") === "更多开关");
  t?.click(); await wait(1200);
});
await longPress("节拍器");
const mn = await cdp.call(() => {
  const d = document.querySelector("[data-hs-metronome-settings]");
  const txt = d ? (d.innerText || "").replace(/\s+/g, " ") : "";
  return { open: Boolean(d), text: txt.slice(0, 170) };
});
console.log("长按节拍器 ⇒ " + JSON.stringify(mn));
check("节拍器长按菜单打开", mn.open, mn.text);
check(
  "菜单含原软件各项（音量/细分/跟随网格/仅每拍/仅小节首/音色/嗒声/木鱼/蜂鸣/强调重拍）",
  /音量/.test(mn.text) && /细分/.test(mn.text) && /跟随网格/.test(mn.text) && /仅每拍/.test(mn.text) &&
    /仅小节首/.test(mn.text) && /音色/.test(mn.text) && /嗒声/.test(mn.text) && /木鱼/.test(mn.text) &&
    /蜂鸣/.test(mn.text) && /强调重拍/.test(mn.text),
  mn.text,
);
// 点「仅小节首」，看是否落到后端设置（get_recording_state 不含节拍器 ⇒ 用 settings 快照命令）
const clicked = await cdp.call(() => {
  const b = [...document.querySelectorAll("[data-hs-metronome-settings] button")].find((x) => (x.textContent || "").trim() === "仅小节首");
  if (!b) return false;
  b.click(); return true;
});
await sleep(1200);
const after = await cdp.call(() => {
  const el = document.querySelector("[data-hs-metronome-settings]");
  return { active: el ? [...el.querySelectorAll("button")].filter((x) => x.getAttribute("aria-pressed") || /solid/.test(String(x.className))).length : -1 };
});
console.log("点「仅小节首」=" + clicked + "  状态：" + JSON.stringify(after));
cdp.close();
