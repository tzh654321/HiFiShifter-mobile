import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const adb = (c) => execSync(`adb -s ${serial} ${c}`, { stdio: "pipe" }).toString();
// 前台窗口
const win = adb("shell dumpsys window");
const focus = (win.match(/mCurrentFocus=\S+ \S+ ([^\s}]+)/) || [])[1] || "(未解析)";
console.log("前台窗口: " + focus);
// UI dump
let xml = "";
try { adb("shell uiautomator dump /sdcard/ui.xml"); xml = adb("shell cat /sdcard/ui.xml"); }
catch (e) { console.log("uiautomator dump 失败: " + String(e.message).slice(0, 120)); }
if (xml) {
  const nodes = [...xml.matchAll(/<node[^>]*>/g)].map((m) => m[0]).map((n) => {
    const g = (k) => (n.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
    return { text: g('text') || g('content-desc'), cls: g('class').split('.').pop(), b: g('bounds'), click: g('clickable') };
  }).filter((x) => x.text || x.click === 'true');
  console.log("节点数: " + nodes.length);
  console.log(JSON.stringify(nodes.slice(0, 22), null, 1));
}
