#!/usr/bin/env node
/**
 * E1/E21 的入口改走**事件桥**，浮层改在 `App.tsx` 渲染。
 *
 * 排查经过：点菜单项即整页卡死（CDP 全超时、进程存活、logcat 无 console 错误）。
 *   · 修 `shallowEqual` → 仍卡；
 *   · 简化控件为 Dialog+Button → 仍卡；
 *   · 换成**自绘浮层**（无 portal/无滚动锁）→ 仍卡
 * ⇒ 卡死不在浮层实现里，而在"**在 `MobileTopBar` 里 setState**"这个动作
 *   （该组件重渲代价异常大）。改法：菜单项只**派发窗口事件**，
 *   浮层由 `App.tsx` 监听并渲染（与 `ClipQuickActions` 等同一个安全位置）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const top = 'upstream-src/frontend/src/components/mobile/MobileTopBar.tsx';
const app = 'upstream-src/frontend/src/App.tsx';

// ── ① MobileTopBar：菜单项改为派发事件，去掉 state 与浮层 ──────────────
let t = readFileSync(top, 'utf8');
t = t.split('\n').filter((l) => !l.includes('<ProjectSettingsDialog') && !l.includes('<StorageSettingsDialog')).join('\n');
t = t
    .split('\n')
    .filter((l) => !/const \[(project|storage)SettingsOpen/.test(l))
    .join('\n');
t = t
    .split('\n')
    .filter((l) => !l.includes('import { ProjectSettingsDialog }') && !l.includes('import { StorageSettingsDialog }'))
    .join('\n');
// 菜单项：把 action 换成派发事件
t = t.replace(
    /const \[projectSettingsOpen, setProjectSettingsOpen\] = React\.useState\(false\);\n/,
    '',
);
t = t.replace(
    /\{ label: t\("menu_project_settings"\), action: \(\) => setProjectSettingsOpen\(true\) \},/,
    '{ label: t("menu_project_settings"), action: () => window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: "project" } })) },',
);
t = t.replace(
    /\{ label: t\("menu_storage_settings"\), action: \(\) => setStorageSettingsOpen\(true\) \},/,
    '{ label: t("menu_storage_settings"), action: () => window.dispatchEvent(new CustomEvent("hs-open-settings", { detail: { which: "storage" } })) },',
);
writeFileSync(top, t, 'utf8');
console.log(
    `MobileTopBar: 事件桥=${t.includes('hs-open-settings')} 残留 state=${/SettingsOpen/.test(t)}`,
);

// ── ② App.tsx：加 state + 事件监听 + 渲染浮层 ─────────────────────────
let a = readFileSync(app, 'utf8');
if (!a.includes('StorageSettingsDialog')) {
    a = a.replace(
        'import { ClipQuickActions } from "./components/mobile/ClipQuickActions";',
        'import { ClipQuickActions } from "./components/mobile/ClipQuickActions";\nimport { ProjectSettingsDialog } from "./components/layout/ProjectSettingsDialog";\nimport { StorageSettingsDialog } from "./components/layout/StorageSettingsDialog";',
    );
    console.log('App.tsx: import 已加');
}
if (!a.includes('hsOpenSettings')) {
    // 在 ClipQuickActions 的渲染处旁边挂两个浮层 + state 放进组件体
    const lines = a.split('\n');
    // state：放在 ClipQuickActions 之前的那一行 `<ClipQuickActions />` 附近找组件体不合适 ⇒
    // 用「与 ClipQuickActions 同一个 return 里」的方式：直接在渲染点插入 state 不可行，
    // 因此 state 用一个极小的独立 hook 组件承载（见下方 SettingsOverlays）。
    const at = lines.findIndex((l) => l.includes('<ClipQuickActions />'));
    if (at >= 0) {
        lines.splice(at, 0, '                    <SettingsOverlays />');
        a = lines.join('\n');
        console.log('App.tsx: <SettingsOverlays /> 已挂载');
    } else {
        console.log('⚠️ 未找到 <ClipQuickActions /> 锚点');
    }
    // hook 组件：自带 state + 监听事件 + 渲染浮层（放在文件末尾，避免与主组件耦合）
    a +=
        '\n\n/**\n * E1/E21 的浮层宿主。\n *\n * 为什么要单独一个组件：直接把这些 state 放进 `MobileTopBar` 时，' +
        '一点菜单项就整页卡死\n * （排查见 docs/TASKS.md：shallowEqual、简化控件、自绘浮层都试过，' +
        '仍卡 ⇒ 问题在 MobileTopBar 里\n * setState 后的大重渲）。改成菜单项**派发窗口事件**、' +
        '这里监听并渲染，就绕开了那条路径。\n */\nfunction SettingsOverlays() {\n' +
        '    const [projectOpen, setProjectOpen] = React.useState(false);\n' +
        '    const [storageOpen, setStorageOpen] = React.useState(false);\n' +
        '    React.useEffect(() => {\n' +
        '        const onOpen = (e: Event) => {\n' +
        '            const which = (e as CustomEvent<{ which?: string }>).detail?.which;\n' +
        '            if (which === "project") setProjectOpen(true);\n' +
        '            else if (which === "storage") setStorageOpen(true);\n' +
        '        };\n' +
        '        window.addEventListener("hs-open-settings", onOpen);\n' +
        '        return () => window.removeEventListener("hs-open-settings", onOpen);\n' +
        '    }, []);\n' +
        '    return (\n' +
        '        <>\n' +
        '            <ProjectSettingsDialog open={projectOpen} onOpenChange={setProjectOpen} />\n' +
        '            <StorageSettingsDialog open={storageOpen} onOpenChange={setStorageOpen} />\n' +
        '        </>\n' +
        '    );\n' +
        '}\n';
    console.log('App.tsx: SettingsOverlays 已追加');
}
writeFileSync(app, a, 'utf8');
console.log('App.tsx 改动完成');
