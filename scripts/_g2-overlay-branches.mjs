#!/usr/bin/env node
/**
 * G-2 第二半：`SettingsOverlays` 里加 `snap-grid` / `split-transition` 两个分支，
 * 分别打开项目**已有**的 `SnapGridSettingsDialog` 与 `SplitTransitionSettingsDialog`。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const app = 'upstream-src/frontend/src/App.tsx';
let a = readFileSync(app, 'utf8');
const before = a;

// ① import 两个对话框
if (!a.includes('SnapGridSettingsDialog')) {
    a = a.replace(
        'import { ProjectSettingsDialog } from "./components/layout/ProjectSettingsDialog";',
        'import { ProjectSettingsDialog } from "./components/layout/ProjectSettingsDialog";\nimport { SnapGridSettingsDialog } from "./components/layout/SnapGridSettingsDialog";\nimport { SplitTransitionSettingsDialog } from "./components/layout/SplitTransitionSettingsDialog";',
    );
}

// ② state + 事件分支
a = a.replace(
    '    const [storageOpen, setStorageOpen] = useState(false);',
    '    const [storageOpen, setStorageOpen] = useState(false);\n' +
        '    /* G-2：^ 菜单里「吸附网格…」「分割过渡…」的长按 ⇒ 打开**原版那套**设置对话框。 */\n' +
        '    const [snapGridOpen, setSnapGridOpen] = useState(false);\n' +
        '    const [splitTransitionOpen, setSplitTransitionOpen] = useState(false);',
);
a = a.replace(
    '            if (which === "project") setProjectOpen(true);\n            else if (which === "storage") setStorageOpen(true);',
    '            if (which === "project") setProjectOpen(true);\n' +
        '            else if (which === "storage") setStorageOpen(true);\n' +
        '            else if (which === "snap-grid") setSnapGridOpen(true);\n' +
        '            else if (which === "split-transition") setSplitTransitionOpen(true);',
);

// ③ 渲染
a = a.replace(
    '            <StorageSettingsDialog open={storageOpen} onOpenChange={setStorageOpen} />',
    '            <StorageSettingsDialog open={storageOpen} onOpenChange={setStorageOpen} />\n' +
        '            <SnapGridSettingsDialog open={snapGridOpen} onOpenChange={setSnapGridOpen} />\n' +
        '            <SplitTransitionSettingsDialog\n' +
        '                open={splitTransitionOpen}\n' +
        '                onOpenChange={setSplitTransitionOpen}\n' +
        '            />',
);

writeFileSync(app, a, 'utf8');
console.log(
    `import=${a.includes('SnapGridSettingsDialog')} state=${a.includes('snapGridOpen')} 分支=${a.includes('"snap-grid"')} 渲染=${a.includes('<SplitTransitionSettingsDialog')}`,
);
console.log(`改动：${before === a ? '无' : '有'}`);
