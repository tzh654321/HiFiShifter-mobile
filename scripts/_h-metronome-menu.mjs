#!/usr/bin/env node
/** 节拍器菜单接线：浮层文件 + ^ 菜单 longPress + SettingsOverlays 分支 + i18n。 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';

// ① 落位浮层组件
copyFileSync('docs/_metronome-overlay.tsx', 'upstream-src/frontend/src/components/layout/MetronomeSettingsOverlay.tsx');
unlinkSync('docs/_metronome-overlay.tsx');
console.log('MetronomeSettingsOverlay.tsx 已落位');

// ② ^ 菜单：节拍器项加 longPress
const bar = 'upstream-src/frontend/src/components/mobile/MobileBottomBar.tsx';
let b = readFileSync(bar, 'utf8');
b = b.replace(
    `            label: \`\${t("mobile_metronome")}…\`,\n            on: s.metronomeEnabled,\n            icon: <IconMetronome />,`,
    `            label: \`\${t("mobile_metronome")}…\`,\n            on: s.metronomeEnabled,\n            icon: <IconMetronome />,\n            /* 长按 = 节拍器设置菜单（音量/细分/音色/强调重拍，按原软件的口径）。 */\n            longPress: () =>\n                window.dispatchEvent(\n                    new CustomEvent("hs-open-settings", { detail: { which: "metronome" } }),\n                ),`,
);
writeFileSync(bar, b, 'utf8');
console.log(`节拍器 longPress=${b.includes('which: "metronome"')}`);

// ③ SettingsOverlays：加 metronome 分支
const app = 'upstream-src/frontend/src/App.tsx';
let a = readFileSync(app, 'utf8');
if (!a.includes('MetronomeSettingsOverlay')) {
    a = a.replace(
        'import { SnapGridSettingsDialog } from "./components/layout/SnapGridSettingsDialog";',
        'import { SnapGridSettingsDialog } from "./components/layout/SnapGridSettingsDialog";\nimport { MetronomeSettingsOverlay } from "./components/layout/MetronomeSettingsOverlay";',
    );
    a = a.replace(
        '    const [splitTransitionOpen, setSplitTransitionOpen] = useState(false);',
        '    const [splitTransitionOpen, setSplitTransitionOpen] = useState(false);\n    /** 节拍器长按菜单（音量/细分/音色/强调重拍）。 */\n    const [metronomeOpen, setMetronomeOpen] = useState(false);',
    );
    a = a.replace(
        '            else if (which === "split-transition") setSplitTransitionOpen(true);',
        '            else if (which === "split-transition") setSplitTransitionOpen(true);\n            else if (which === "metronome") setMetronomeOpen(true);',
    );
    a = a.replace(
        '            <SplitTransitionSettingsDialog',
        '            <MetronomeSettingsOverlay open={metronomeOpen} onOpenChange={setMetronomeOpen} />\n            <SplitTransitionSettingsDialog',
    );
}
writeFileSync(app, a, 'utf8');
console.log(
    `overlay import=${a.includes('MetronomeSettingsOverlay')} state=${a.includes('metronomeOpen')} 分支=${a.includes('"metronome")')} 渲染=${a.includes('<MetronomeSettingsOverlay')}`,
);

// ④ i18n（5 语言）
const KEYS = {
    'zh-CN': ['启用', '音量', '细分', '跟随网格', '仅每拍', '仅小节首', '音色', '嗒声', '木鱼', '蜂鸣', '强调重拍'],
    'zh-TW': ['啟用', '音量', '細分', '跟隨格線', '僅每拍', '僅小節首', '音色', '嗒聲', '木魚', '蜂鳴', '強調重拍'],
    'en-US': ['Enabled', 'Volume', 'Subdivision', 'Follow grid', 'Beat only', 'Bar start only', 'Sound', 'Click', 'Woodblock', 'Beep', 'Accent downbeat'],
    'ja-JP': ['有効', '音量', '細分', 'グリッドに追従', '拍のみ', '小節頭のみ', '音色', 'クリック', '木魚', 'ビープ', '強拍を強調'],
    'ko-KR': ['사용', '볼륨', '세분', '그리드 따르기', '박자만', '마디 첫박만', '음색', '클릭', '목어', '비프', '강박 강조'],
};
const NAMES = [
    'hs_mn_enabled',
    'hs_mn_volume',
    'hs_mn_mode',
    'hs_mn_mode_grid',
    'hs_mn_mode_beat',
    'hs_mn_mode_bar',
    'hs_mn_sound',
    'hs_mn_sound_click',
    'hs_mn_sound_woodblock',
    'hs_mn_sound_beep',
    'hs_mn_accent',
];
for (const [loc, vals] of Object.entries(KEYS)) {
    const p = `upstream-src/frontend/src/i18n/${loc}.ts`;
    let t = readFileSync(p, 'utf8');
    if (t.includes('hs_mn_enabled')) {
        console.log(`${loc}: 已有`);
        continue;
    }
    const lines = t.split('\n');
    const at = lines.findIndex((l) => /^\s*menu_snap_grid_settings:/.test(l));
    const ind = at >= 0 ? (lines[at].match(/^\s*/) ?? [''])[0] : '    ';
    const block = NAMES.map((n, i) => `${ind}${n}: ${JSON.stringify(vals[i])},`);
    lines.splice(at >= 0 ? at + 1 : 1, 0, ...block);
    writeFileSync(p, lines.join('\n'), 'utf8');
    console.log(`${loc}: 注入 ${NAMES.length} 个键`);
}
