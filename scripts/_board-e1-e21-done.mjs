#!/usr/bin/env node
/** E1/E21 状态写回 + 「卡死」误判的更正与教训。 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'docs/TASKS.md';
let text = readFileSync(path, 'utf8');
const lines = text.split('\n');
const findRow = (key) => lines.findIndex((l) => l.startsWith(`| ${key} | `));

const i1 = findRow('E1');
if (i1 >= 0) {
    lines[i1] =
        '| E1 | 加入**工程设置界面**，放在**菜单栏-文件**的选项中（"曾经好像提过"）| ✅ **DONE**：`ProjectSettingsDialog`（自绘浮层）—— 工程名/工程路径（只读，改名走「另存为」）、基础音阶、每小节拍数、拍号分母、网格、保存撤销历史；网格与拍数**可直接点选**，走已有的 `setProjectTimelineSettings` 命令。手机端入口挂在**文件菜单**（`MobileTopBar` 的声明式数组）。<br>⚠️ 排查过程中我一度判定"打开该对话框会卡死"并摘掉入口 —— **那是误判**，见文末「教训」 | ✅ DONE（真机 `_probe-e1-e21-clean.mjs` 3/3：菜单项存在 · 浮层打开且字段齐全 · 网格按钮点击后后端 `grid_size` 1/4→1/1）|';
}
const i21 = findRow('E21');
if (i21 >= 0) {
    lines[i21] =
        '| E21 | **（覆盖旧口径）** 默认存储目录改到 `storage/emulated/0/HiFiShifter`（含录音、工程等）；**未授权时仍存在 android/data**；**菜单-选项 加一栏「存储设置」**：可设默认存储位置、查看并**跳转**三种授权的生效情况 | ✅ **DONE（后端 + UI）**：`storage.rs` 统一入口 `resolve_storage_root`（用户设置 → 全盘访问时 `/storage/emulated/0/HiFiShifter` → 未授权回退私有目录），已接进工程默认文件夹 ⇒ 录音/自动备份随之落位；命令 `storage_settings_state` / `set_storage_root` / `open_path_in_file_manager`；`StorageSettingsDialog`（自绘浮层）：生效目录 + 「在文件浏览器中打开」跳转 + 三种授权状态与对应动作（去设置 / 选目录 / 连接 Shizuku）| ✅ DONE（真机 6/6：生效目录 = `/storage/emulated/0/HiFiShifter`（不再是 android/data）· 三种授权齐全 · 自定义根可设可清 · 选项菜单有「存储设置…」· 浮层显示正确）|';
}
writeFileSync(path, lines.join('\n'), 'utf8');

const lesson = `
---

## ⚠️ 教训：「页面卡死」是我误判的 —— 探针把应用切到后台导致的假象（2026-09-29 深夜）

**我一度判定**「点开 E1/E21 的对话框会让页面卡死」，并因此摘掉入口、连做三轮构建尝试
（补 \`shallowEqual\` → 简化控件 → 换自绘浮层 → 改走事件桥 + 在 App.tsx 渲染），**全都没用**。

**真相**：那个"卡死"是**探针的假象**。
\`_probe-e1-e21.mjs\` 的 E21 分支里调用了 \`pickDirectory()\`（SAF 目录选择器）与
\`openAllFilesAccessSettings()\`（系统设置页）—— **这两个都会把应用切到后台**。
WebView 在后台**暂停 JS**，于是随后所有 \`Runtime.evaluate\` 都 30s 超时 ⇒
看起来像"页面卡死"。用 \`adb screencap\` 截图才看清：**前台是手机的系统文件管理器**
（路径 \`.aaa\`，正是 SAF 授权目录），我们的应用根本不在前台。

**铁证**：改用**只做应用内操作**的纯净探针（\`_probe-e1-e21-clean.mjs\`）后，
两个浮层**都能正常打开**，E1 3/3、E21 3/3 全通过。

**留给后人的检查清单**（遇到"CDP 求值超时"时先查这些，别急着改代码）：
1. \`adb shell dumpsys window | grep mCurrentFocus\` —— **前台是不是我们的应用**；
   不是（常见：SAF 选择器 / 系统设置页 / 权限对话框）⇒ 超时与代码无关；
2. \`adb shell pidof <pkg>\` —— 进程还在吗（区分"崩溃"与"只是被切走"）；
3. \`adb exec-out screencap\` 截图 —— 用户视角一眼看清；
4. \`logcat\` 里有没有 \`chromium\`/\`Tauri/Console\` 的 React 报错
   （真死循环通常会有 \`Maximum update depth exceeded\`；一条都没有就别怀疑重渲循环）。

**顺带修正**：radix 的 \`Dialog\`/\`Select\` 在本项目里用法没问题（\`ExportAudioDialog\` 一直正常），
我最后改成自绘浮层是**为了排查**，本身不是必须的；现在保留自绘版本（与项目里
\`SelectToolMenu\`/\`DrawToolMenu\` 风格一致、无 portal 与滚动锁，更可控）。
`;
writeFileSync(path, text + lesson, 'utf8');
console.log(`E1 行=${i1 + 1}  E21 行=${i21 + 1}  教训已追加`);
