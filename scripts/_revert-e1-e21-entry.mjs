#!/usr/bin/env node
/**
 * 临时回退：把 E1/E21 的**菜单入口**从手机端菜单里摘掉。
 *
 * 原因：真机实测"点这两个菜单项后页面直接卡死（CDP 求值全部超时）"，
 * 简化到只用 Dialog+Button 仍然卡 ⇒ 问题在"打开 Dialog 这个动作"本身，尚未定位。
 * 为避免用户**点到就卡**，先摘掉入口；组件文件与后端能力都保留，修好即可一键恢复。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileTopBar.tsx';
let text = readFileSync(path, 'utf8');
const before = text;

const dropLines = (t, pred) =>
    t
        .split('\n')
        .filter((l) => !pred(l))
        .join('\n');

// 菜单项
text = dropLines(text, (l) => l.includes('menu_project_settings') || l.includes('menu_storage_settings'));
// 注释行（两条 E1/E21 的说明）
text = dropLines(
    text,
    (l) => l.includes('E1：「工程设置」放在') || l.includes('E21：「存储设置」放在'),
);
// 渲染
text = dropLines(text, (l) => l.includes('<ProjectSettingsDialog') || l.includes('<StorageSettingsDialog'));
// state
text = dropLines(text, (l) => /const \[(project|storage)SettingsOpen/.test(l));
text = dropLines(text, (l) => /E1：工程设置（文件菜单）/.test(l) || /E21：存储设置（选项菜单）/.test(l));
// import
text = dropLines(
    text,
    (l) => l.includes('import { ProjectSettingsDialog }') || l.includes('import { StorageSettingsDialog }'),
);

// 清掉"菜单项被删后可能留下的空 sep 行重复"不做处理（无害）。
writeFileSync(path, text, 'utf8');
const leftovers = ['menu_project_settings', 'menu_storage_settings', 'projectSettingsOpen', 'storageSettingsOpen'].filter(
    (k) => text.includes(k),
);
console.log(`改动：${before === text ? '无' : '有'}`);
console.log(`残留关键字：${leftovers.length ? leftovers.join(', ') : '（无）'}`);
