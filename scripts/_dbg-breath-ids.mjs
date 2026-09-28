import { execSync } from "node:child_process";
import { Cdp } from "./lib/cdp.mjs";
const serial = "emulator-5554";
const pid = execSync(`adb -s ${serial} shell pidof com.arounder.hifishifter`).toString().trim();
execSync(`adb -s ${serial} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
const cdp = await Cdp.attach({ host: "127.0.0.1", port: 9222 });
await cdp.send("Runtime.enable");
// 参数面板必须可见（工具行才挂载）
await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim() === '视图');
  if (!document.querySelector('.hs-param-rows')) {
    t && t.click(); await wait(700);
    const it = [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],button,div')].find((x) => ((x.getAttribute('aria-label')||'').trim() === '参数面板' || (x.textContent||'').trim() === '参数面板') && x.children.length <= 3);
    it && it.click(); await wait(1800);
  }
});
const real = await cdp.call(() => {
  const s = window.__hsParamUiState || {};
  return { editParam: s.editParam, params: (s.params||[]).map((p) => ({ id: p.id, label: p.label, secondary: p.secondary, hasBreathSwitch: p.hasBreathSwitch, breathOn: p.breathOn })) };
});
console.log("▸ 真实镜像状态: " + JSON.stringify(real, null, 1));
// 注入一份含各种算法 id 的假状态，看左侧图标各画成什么
const probe = await cdp.call(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ids = ["pitch","formant_shift_cents","breathiness","breath_gain","tension","hifigan_tension","volume","pan"];
  const state = { editParam: "volume", overlaysVisible: true, params: ids.map((id) => ({ id, label: id, secondary: false, hasBreathSwitch: id === "breath_gain" || id === "breathiness", breathOn: true })) };
  window.__hsParamUiState = state;
  window.dispatchEvent(new CustomEvent("hs-param-ui-state", { detail: state }));
  await wait(600);
  // 打开 👁 面板
  const eye = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('data-tooltip') || b.ariaLabel || '') === '参数与覆盖层');
  eye && eye.click();
  await wait(900);
  const sig = (svg) => {
    if (!svg) return "(无 svg)";
    const paths = [...svg.querySelectorAll('path')].map((p) => (p.getAttribute('d')||'').slice(0, 14));
    return paths.join(' ');
  };
  const rows = [...document.querySelectorAll('button[aria-label]')].filter((b) => ids.includes((b.getAttribute('aria-label')||'').trim()));
  return rows.map((b) => {
    const wrap = b.querySelector('span[aria-hidden="true"]');
    const svg = wrap ? wrap.querySelector('svg') : null;
    const box = b.parentElement;
    const pill = box ? [...box.querySelectorAll('button')].find((x) => /^气声[:：]/.test(x.getAttribute('aria-label')||'')) : null;
    const pillSvg = pill ? pill.querySelector('svg') : null;
    return {
      id: (b.getAttribute('aria-label')||'').trim(),
      leftOpacity: wrap ? getComputedStyle(wrap).opacity : null,
      leftIcon: sig(svg),
      pillIcon: sig(pillSvg),
      pillOpacity: pillSvg ? getComputedStyle(pillSvg).opacity : null,
    };
  });
});
console.log("▸ 各 id 的左右图标：");
for (const r of probe) console.log("  " + JSON.stringify(r));
cdp.close();
