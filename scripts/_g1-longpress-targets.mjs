#!/usr/bin/env node
/**
 * G 组第 1 批（用户口径）：
 *   G-2「吸附网格与分割过渡的长按后界面对应原版软件的**吸附网格设置**与**分割过渡设置**，
 *        而不是工程设置；我才发现怎么所有按钮长按都进工程设置，要改」
 *   G-4「『节拍器』更名『节拍器…』，因为它也有长按菜单」
 *
 * 做法：
 *   · `snap` / `splitTransition` 各自带 `longPress`，分别派发
 *     `hs-open-settings {which:"snap-grid"|"split-transition"}` —— 这两个对话框项目里**已有**
 *     （`SnapGridSettingsDialog` / `SplitTransitionSettingsDialog`），直接复用，不再自己造；
 *   · 长按处理里**删掉**"没给 longPress 就打开工程设置"的兜底 —— 那正是"所有按钮长按都进工程设置"
 *     的来源；现在**没给 longPress 的项长按无反应**；
 *   · 节拍器 label 加「…」。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const bar = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let t = readFileSync(bar, 'utf8');
const before = t;

// ① snap 项：带 longPress → 吸附网格设置
t = t.replace(
    /\{ id: "snap", label: `\$\{t\("mobile_grid_snap" as never\)\}…`, on: s\.snapEnabled, icon: <IconSnap \/>, act: flip\(toggleSnap\) \},/,
    `{
            id: "snap",
            label: \`\${t("mobile_grid_snap" as never)}…\`,
            on: s.snapEnabled,
            icon: <IconSnap />,
            act: flip(toggleSnap),
            /* G-2：长按 = 原版软件的「吸附网格设置」（项目里已有该对话框，直接复用）。 */
            longPress: () =>
                window.dispatchEvent(
                    new CustomEvent("hs-open-settings", { detail: { which: "snap-grid" } }),
                ),
        },`,
);

// ② splitTransition 项：带 longPress → 分割过渡设置
t = t.replace(
    /label: `\$\{t\("mobile_split_transition"\)\}…`,/,
    `label: \`\${t("mobile_split_transition")}…\`,
            /* G-2：长按 = 原版软件的「分割过渡设置」（同样复用已有对话框）。 */
            longPress: () =>
                window.dispatchEvent(
                    new CustomEvent("hs-open-settings", { detail: { which: "split-transition" } }),
                ),`,
);

// ③ 节拍器改名（G-4）
t = t.replace('label: t("mobile_metronome"),', 'label: `${t("mobile_metronome")}…`,');

// ④ 长按处理：删掉"默认打开工程设置"的兜底（改成没有 longPress 就什么都不做）
t = t.replace(
    /        if \(item\.longPress\) \{\n            item\.longPress\(\);\n            return;\n        \}\n[\s\S]*?window\.dispatchEvent\(\n            new CustomEvent\("hs-open-settings", \{ detail: \{ which: "project" \} \}\),\n        \);\n/,
    `        /* G-2：**只对提供了 longPress 的项**打开菜单；没有的项长按**无反应**。
           （原来这里兜底打开「工程设置」，导致"所有按钮长按都进工程设置"。） */
        item.longPress?.();
`,
);
writeFileSync(bar, t, 'utf8');
console.log(
    `snap longPress=${/id: "snap"[\s\S]{0,400}?snap-grid/.test(t)}  split longPress=${t.includes('split-transition')}  节拍器改名=${t.includes('mobile_metronome")}…')}  兜底已删=${!t.includes('detail: { which: "project" }')}`,
);
console.log(`改动：${before === t ? '无' : '有'}`);
