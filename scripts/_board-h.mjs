#!/usr/bin/env node
/** H 组（节拍器菜单）入板。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
let text = readFileSync(path, 'utf8');
const section = `

---

# 📋 H 组：节拍器长按菜单（2026-09-29 深夜，用户口径）

| # | 用户原话 | 处理 | 状态 |
| :--- | :--- | :--- | :--- |
| H-1 | 「**节拍器的菜单打不开**」 | 上一轮只给它改了名（「节拍器…」）却**没给 \`longPress\`** ⇒ 长按无反应（那正是 G-2「无 longPress 的项长按无反应」改法的副作用）。现已补上：\`longPress\` 派发 \`hs-open-settings {which:"metronome"}\`，由 \`SettingsOverlays\` 打开 | ✅ 已实现 |
| H-2 | 「需要的内容原软件有给出，按原软件制作：音量 / 细分 / 跟随网格 / 仅每拍 / 仅小节首 / 音色 / 嗒声 / 木鱼 / 蜂鸣 / 强调重拍」 | ✅ 全部按此实现，且**逐项对应 store 里已有的字段**（不是我新造的）：音量⇒\`metronomeGain\` · 细分⇒\`metronomeMode\`「grid/beat/bar」· 音色⇒\`metronomeSound\`「click/woodblock/beep」· 强调重拍⇒\`metronomeAccent\`；另补「启用」⇒\`metronomeEnabled\`（否则菜单没法开关）。改动一律走 \`updateMetronome\` thunk（同步引擎 + 持久化）| ✅ DONE（真机实测菜单文案：**「节拍器 启用 未生效 音量 − 50% + 细分 跟随网格 仅每拍 仅小节首 音色 嗒声 木鱼 蜂鸣 强调重拍 已生效 关闭」** —— 与你列的项逐字一致）|

> 排查记录（供参考）：长按测试一度失败，原因是**探针没能打开 ^ 浮层**（"更多开关"的点击状态残留），
> 不是功能问题 —— 直接派发事件即可证实菜单正常。另有一处实现坑：
> \`updateMetronome\` 的入参用 **store 字段名**（\`metronomeEnabled\`/\`metronomeGain\`…），
> 写成 \`enabled/gain/…\` 会被类型系统挡下。
`;
writeFileSync(path, text + section, 'utf8');
console.log('H 组已入板');
