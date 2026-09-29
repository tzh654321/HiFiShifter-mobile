#!/usr/bin/env node
/**
 * E1/E21 的 i18n 键批量注入（5 语言）。
 *
 * 插在每种语言 `menu_options:` 那一行之后，保持对象字面量合法。
 * 幂等：已存在 `menu_storage_settings` 就跳过。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const KEYS = {
    'zh-CN': [
        ['menu_project_settings', '工程设置…'],
        ['menu_storage_settings', '存储设置…'],
        ['project_settings_desc', '工程级设置（与全局外观设置分开）。改动即时生效。'],
        ['project_name_label', '工程名'],
        ['project_unsaved_hint', '（未保存：保存后这里显示工程文件路径）'],
        ['storage_settings_desc', '设置默认存储位置，并查看三种文件访问授权的生效情况。'],
        ['storage_effective_root', '实际生效目录'],
        ['storage_using_fallback', '授权不足，已回退到私有目录'],
        ['storage_open_in_browser', '在文件浏览器中打开'],
        ['storage_custom_root', '默认存储位置（留空 = 用默认）'],
        ['storage_default_root', '默认'],
        ['storage_save', '保存'],
        ['storage_use_default', '用默认'],
        ['storage_access_title', '文件访问授权'],
        ['storage_access_all_files', '所有文件访问'],
        ['storage_access_all_files_desc', '一次授权即可读写共享存储的真路径（推荐）'],
        ['storage_access_saf', 'SAF 目录授权'],
        ['storage_access_saf_desc', '按目录授权；授权目录内的文件读取前会自动物化'],
        ['storage_access_shizuku', 'Shizuku（shell 身份）'],
        ['storage_access_shizuku_desc', '可读取 Android/data 等只有 shell 身份能碰的目录'],
        ['storage_state_on', '已生效'],
        ['storage_state_off', '未生效'],
        ['storage_go_settings', '去设置'],
        ['storage_pick_dir', '选择目录'],
        ['storage_bind_shizuku', '连接'],
        ['storage_error_unusable_root', '这个目录不可用（不存在或不可写），请换一个。'],
        ['save_undo_history_desc', '随工程保存撤销历史（文件更大，但可跨会话撤销）'],
    ],
    'zh-TW': [
        ['menu_project_settings', '專案設定…'],
        ['menu_storage_settings', '儲存設定…'],
        ['project_settings_desc', '專案層級設定（與全域外觀設定分開）。變更即時生效。'],
        ['project_name_label', '專案名稱'],
        ['project_unsaved_hint', '（尚未儲存：儲存後這裡會顯示專案檔路徑）'],
        ['storage_settings_desc', '設定預設儲存位置，並檢視三種檔案存取授權的生效情況。'],
        ['storage_effective_root', '實際生效目錄'],
        ['storage_using_fallback', '授權不足，已回退到私有目錄'],
        ['storage_open_in_browser', '在檔案瀏覽器中開啟'],
        ['storage_custom_root', '預設儲存位置（留空 = 用預設）'],
        ['storage_default_root', '預設'],
        ['storage_save', '儲存'],
        ['storage_use_default', '用預設'],
        ['storage_access_title', '檔案存取授權'],
        ['storage_access_all_files', '所有檔案存取'],
        ['storage_access_all_files_desc', '一次授權即可讀寫共享儲存的真路徑（建議）'],
        ['storage_access_saf', 'SAF 目錄授權'],
        ['storage_access_saf_desc', '依目錄授權；授權目錄內的檔案讀取前會自動物化'],
        ['storage_access_shizuku', 'Shizuku（shell 身分）'],
        ['storage_access_shizuku_desc', '可讀取 Android/data 等只有 shell 身分能碰的目錄'],
        ['storage_state_on', '已生效'],
        ['storage_state_off', '未生效'],
        ['storage_go_settings', '去設定'],
        ['storage_pick_dir', '選擇目錄'],
        ['storage_bind_shizuku', '連線'],
        ['storage_error_unusable_root', '這個目錄不可用（不存在或不可寫），請換一個。'],
        ['save_undo_history_desc', '隨專案儲存復原歷史（檔案較大，但可跨工作階段復原）'],
    ],
    'en-US': [
        ['menu_project_settings', 'Project Settings…'],
        ['menu_storage_settings', 'Storage Settings…'],
        ['project_settings_desc', 'Project-level settings (separate from global appearance). Changes apply immediately.'],
        ['project_name_label', 'Project name'],
        ['project_unsaved_hint', '(Unsaved — the project file path shows here after saving)'],
        ['storage_settings_desc', 'Set the default storage location and review the three file-access grants.'],
        ['storage_effective_root', 'Effective folder'],
        ['storage_using_fallback', 'insufficient grants — using private folder'],
        ['storage_open_in_browser', 'Open in file browser'],
        ['storage_custom_root', 'Default storage location (empty = default)'],
        ['storage_default_root', 'Default'],
        ['storage_save', 'Save'],
        ['storage_use_default', 'Use default'],
        ['storage_access_title', 'File access grants'],
        ['storage_access_all_files', 'All files access'],
        ['storage_access_all_files_desc', 'One grant gives real-path read/write on shared storage (recommended)'],
        ['storage_access_saf', 'SAF folder grant'],
        ['storage_access_saf_desc', 'Per-folder grant; files inside are materialized before reading'],
        ['storage_access_shizuku', 'Shizuku (shell identity)'],
        ['storage_access_shizuku_desc', 'Reaches Android/data and other shell-only folders'],
        ['storage_state_on', 'Active'],
        ['storage_state_off', 'Inactive'],
        ['storage_go_settings', 'Settings'],
        ['storage_pick_dir', 'Pick folder'],
        ['storage_bind_shizuku', 'Connect'],
        ['storage_error_unusable_root', 'That folder is unusable (missing or not writable). Pick another.'],
        ['save_undo_history_desc', 'Store undo history with the project (larger file, undo across sessions)'],
    ],
    'ja-JP': [
        ['menu_project_settings', 'プロジェクト設定…'],
        ['menu_storage_settings', 'ストレージ設定…'],
        ['project_settings_desc', 'プロジェクト単位の設定（全体の外観設定とは別）。変更は即時反映されます。'],
        ['project_name_label', 'プロジェクト名'],
        ['project_unsaved_hint', '（未保存：保存後にここへプロジェクトのパスが表示されます）'],
        ['storage_settings_desc', '既定の保存先を設定し、3 種類のファイルアクセス許可の状態を確認できます。'],
        ['storage_effective_root', '実際に有効なフォルダ'],
        ['storage_using_fallback', '権限不足のためプライベート領域に退避'],
        ['storage_open_in_browser', 'ファイルブラウザで開く'],
        ['storage_custom_root', '既定の保存先（空欄 = 既定を使用）'],
        ['storage_default_root', '既定'],
        ['storage_save', '保存'],
        ['storage_use_default', '既定を使う'],
        ['storage_access_title', 'ファイルアクセス許可'],
        ['storage_access_all_files', 'すべてのファイルへのアクセス'],
        ['storage_access_all_files_desc', '1 回の許可で共有ストレージを実パスで読み書き（推奨）'],
        ['storage_access_saf', 'SAF フォルダ許可'],
        ['storage_access_saf_desc', 'フォルダ単位の許可。許可内のファイルは読む前に実体化されます'],
        ['storage_access_shizuku', 'Shizuku（shell 権限）'],
        ['storage_access_shizuku_desc', 'Android/data など shell 権限でのみ到達できる場所を読めます'],
        ['storage_state_on', '有効'],
        ['storage_state_off', '無効'],
        ['storage_go_settings', '設定へ'],
        ['storage_pick_dir', 'フォルダ選択'],
        ['storage_bind_shizuku', '接続'],
        ['storage_error_unusable_root', 'このフォルダは使用できません（存在しない／書き込めない）。別を選んでください。'],
        ['save_undo_history_desc', 'プロジェクトと一緒に undo 履歴を保存（ファイルは大きくなります）'],
    ],
    'ko-KR': [
        ['menu_project_settings', '프로젝트 설정…'],
        ['menu_storage_settings', '저장소 설정…'],
        ['project_settings_desc', '프로젝트 수준 설정(전역 모양 설정과 별개). 변경은 즉시 적용됩니다.'],
        ['project_name_label', '프로젝트 이름'],
        ['project_unsaved_hint', '(저장되지 않음 — 저장하면 여기에 프로젝트 파일 경로가 표시됩니다)'],
        ['storage_settings_desc', '기본 저장 위치를 설정하고 세 가지 파일 접근 권한 상태를 확인합니다.'],
        ['storage_effective_root', '실제 적용 폴더'],
        ['storage_using_fallback', '권한 부족 — 비공개 폴더로 대체'],
        ['storage_open_in_browser', '파일 브라우저에서 열기'],
        ['storage_custom_root', '기본 저장 위치(비우면 기본값)'],
        ['storage_default_root', '기본'],
        ['storage_save', '저장'],
        ['storage_use_default', '기본값 사용'],
        ['storage_access_title', '파일 접근 권한'],
        ['storage_access_all_files', '모든 파일 접근'],
        ['storage_access_all_files_desc', '한 번 허용하면 공유 저장소를 실제 경로로 읽고 씁니다(권장)'],
        ['storage_access_saf', 'SAF 폴더 권한'],
        ['storage_access_saf_desc', '폴더 단위 권한. 권한 내 파일은 읽기 전에 실체화됩니다'],
        ['storage_access_shizuku', 'Shizuku(shell 권한)'],
        ['storage_access_shizuku_desc', 'Android/data 처럼 shell 권한만 닿는 폴더를 읽을 수 있습니다'],
        ['storage_state_on', '적용됨'],
        ['storage_state_off', '미적용'],
        ['storage_go_settings', '설정으로'],
        ['storage_pick_dir', '폴더 선택'],
        ['storage_bind_shizuku', '연결'],
        ['storage_error_unusable_root', '이 폴더는 사용할 수 없습니다(없거나 쓰기 불가). 다른 곳을 선택하세요.'],
        ['save_undo_history_desc', '프로젝트와 함께 undo 기록 저장(파일이 커지지만 세션 간 undo 가능)'],
    ],
};

let changed = 0;
for (const [loc, pairs] of Object.entries(KEYS)) {
    const path = `upstream-src/frontend/src/i18n/${loc}.ts`;
    const text = readFileSync(path, 'utf8');
    if (text.includes('menu_storage_settings')) {
        console.log(`${loc}: 已有键，跳过`);
        continue;
    }
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^\s*menu_options:/.test(l));
    if (at < 0) {
        console.log(`${loc}: 未找到 menu_options 锚点，跳过`);
        continue;
    }
    const indent = (lines[at].match(/^\s*/) ?? [''])[0];
    const block = pairs.map(([k, v]) => `${indent}${k}: ${JSON.stringify(v)},`);
    lines.splice(at + 1, 0, ...block);
    writeFileSync(path, lines.join('\n'), 'utf8');
    changed += 1;
    console.log(`${loc}: 注入 ${pairs.length} 个键`);
}
console.log(`完成，改动 ${changed} 个语言文件`);
