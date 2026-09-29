#!/usr/bin/env node
/**
 * 把 E1/E21 的入口接进**手机端**菜单（`MobileTopBar`）。
 *
 * 教训：桌面用 `MenuBar`（Radix DropdownMenu 的 JSX），手机端是**同一语义的触摸实现**，
 * 菜单项写成声明式数组（`MenuEntry { label, action, sub, sep }`）—— 改错文件就会出现
 * "代码在、菜单里没有"。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'upstream-src/frontend/src/components/mobile/MobileTopBar.tsx';
let text = readFileSync(path, 'utf8');
const before = text;

const log = [];

// ① import（插到最后一个 import 之后）
if (!text.includes('ProjectSettingsDialog')) {
    const lines = text.split('\n');
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) if (/^import /.test(lines[i])) lastImport = i;
    lines.splice(
        lastImport + 1,
        0,
        'import { ProjectSettingsDialog } from "../layout/ProjectSettingsDialog";',
        'import { StorageSettingsDialog } from "../layout/StorageSettingsDialog";',
    );
    text = lines.join('\n');
    log.push('import 已加');
}

// ② state（挂在 export 对话框 state 之后）
if (!text.includes('projectSettingsOpen')) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /const \[exportOpen, setExportOpen\]/.test(l));
    if (at >= 0) {
        lines.splice(
            at + 1,
            0,
            '    /** E1：工程设置（文件菜单）。 */',
            '    const [projectSettingsOpen, setProjectSettingsOpen] = React.useState(false);',
            '    /** E21：存储设置（选项菜单）。 */',
            '    const [storageSettingsOpen, setStorageSettingsOpen] = React.useState(false);',
        );
        text = lines.join('\n');
        log.push('state 已加');
    } else {
        log.push('⚠️ 未找到 exportOpen state 锚点');
    }
}

// ③ 菜单项
if (!text.includes('menu_project_settings')) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /menu_file: \[/.test(l));
    if (at >= 0) {
        lines.splice(
            at + 1,
            0,
            '            /* E1：「工程设置」放在**文件**菜单里（用户口径）。 */',
            '            { label: t("menu_project_settings"), action: () => setProjectSettingsOpen(true) },',
            '            { sep: true, label: "" },',
        );
        text = lines.join('\n');
        log.push('文件菜单项已加');
    } else {
        log.push('⚠️ 未找到 menu_file 锚点');
    }
}
if (!text.includes('menu_storage_settings')) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /menu_options: \[/.test(l));
    if (at >= 0) {
        lines.splice(
            at + 1,
            0,
            '            /* E21：「存储设置」放在**选项**菜单里（用户口径）。 */',
            '            { label: t("menu_storage_settings"), action: () => setStorageSettingsOpen(true) },',
            '            { sep: true, label: "" },',
        );
        text = lines.join('\n');
        log.push('选项菜单项已加');
    } else {
        log.push('⚠️ 未找到 menu_options 锚点');
    }
}

// ④ 渲染两个对话框（挂在 ExportAudioDialog 之前）
if (!text.includes('<ProjectSettingsDialog')) {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /<ExportAudioDialog/.test(l));
    if (at >= 0) {
        lines.splice(
            at,
            0,
            '            <ProjectSettingsDialog open={projectSettingsOpen} onOpenChange={setProjectSettingsOpen} />',
            '            <StorageSettingsDialog open={storageSettingsOpen} onOpenChange={setStorageSettingsOpen} />',
        );
        text = lines.join('\n');
        log.push('对话框渲染已加');
    } else {
        log.push('⚠️ 未找到 ExportAudioDialog 锚点');
    }
}

writeFileSync(path, text, 'utf8');
console.log(log.join('\n'));
console.log(`改动：${before === text ? '无' : '有'}`);
