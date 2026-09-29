import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "221deeb";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
const pid = adb("shell pidof com.arounder.hifishifter").trim();
adb("forward tcp:9222 localabstract:webview_devtools_remote_" + pid);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
const dump = await cdp.call(async () => {
  const attrs = new Set();
  document.querySelectorAll("*").forEach((el) => { for (const a of el.attributes || []) if (a.name.startsWith("data-")) attrs.add(a.name); });
  const canvases = [...document.querySelectorAll("canvas")].map((c) => {
    const r = c.getBoundingClientRect();
    const vis = r.width > 0 && r.height > 0;
    return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), visible: vis, inDom: c.isConnected };
  });
  // 视图菜单项
  const readMenu = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const trig = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "视图");
    trig && trig.click();
    await wait(900);
    const items = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox]')].map((x) => ({
      text: (x.textContent || "").trim().slice(0, 16),
      state: x.getAttribute("aria-checked") || x.getAttribute("data-state") || "",
    }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return items;
  };
  const items = await readMenu();
  return {
    canvasCount: canvases.length,
    visibleCanvases: canvases.filter((c) => c.visible).length,
    canvases: canvases.slice(0, 14),
    viewMenuItems: items,
    hsAttrNames: [...attrs].filter((a) => /surface|param|timeline|kernel|piano/.test(a)),
  };
});
console.log(JSON.stringify(dump, null, 1).slice(0, 2600));
cdp.close();
