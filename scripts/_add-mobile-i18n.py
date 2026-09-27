#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 5 个语种文件批量追加「移动端外壳」的 i18n 键，并把组件里的硬编码中文换成 t("…")。

背景（2026-09-22）：`MobileBottomBar.tsx` / `BottomTabs.tsx` 是 fork 后**新加**的组件，
上游 i18n 里没有它们的键（`src/i18n/` 里搜不到 `mobile_*`），所以切语言时移动端纹丝不动。
本脚本一次性补齐：**先给 5 个语种各加同一组键**（键类型由 `en-US` 决定，必须它先有），
**再改组件**。

⚠️ 键必须 5 语种同步：`MessageKey = keyof typeof enUS`，缺一个语种就会在 tsc 报错。

用法：
    python scripts/_add-mobile-i18n.py            # 只报告要做什么
    python scripts/_add-mobile-i18n.py --apply    # 真写
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / "upstream-src" / "frontend" / "src" / "i18n"
MOBILE = ROOT / "upstream-src" / "frontend" / "src" / "components" / "mobile"

# 键名 → 5 语种译文。顺序：zh-CN / zh-TW / en-US / ja-JP / ko-KR
KEYS = {
    # ── 底部页签（BottomTabs）─────────────────────────────────────────────
    "mobile_tab_timeline":      ("轨道", "軌道", "Timeline", "タイムライン", "타임라인"),
    "mobile_tab_params":        ("参数", "參數", "Params", "パラメータ", "파라미터"),
    "mobile_tab_files":         ("文件", "檔案", "Files", "ファイル", "파일"),
    "mobile_tab_notes":         ("笔记", "筆記", "Notes", "ノート", "노트"),
    "mobile_tab_switcher":      ("主面板切换", "主面板切換", "Main panel switcher", "メインパネル切替", "메인 패널 전환"),
    # ── 绘制工具子菜单 ────────────────────────────────────────────────────
    "mobile_tool_draw":         ("绘制", "繪製", "Draw", "描画", "그리기"),
    "mobile_tool_vibrato":      ("颤音", "顫音", "Vibrato", "ビブラート", "비브라토"),
    "mobile_tool_menu":         ("绘制工具", "繪製工具", "Draw tool", "描画ツール", "그리기 도구"),
    "mobile_close_tool_menu":   ("关闭工具菜单", "關閉工具選單", "Close tool menu", "ツールメニューを閉じる", "도구 메뉴 닫기"),
    "mobile_close_overlay":     ("关闭浮层", "關閉浮層", "Close overlay", "オーバーレイを閉じる", "오버레이 닫기"),
    # ── 底栏开关（9 个 + 波纹）───────────────────────────────────────────
    "mobile_ripple_off":        ("波纹:关", "波紋:關", "Ripple: Off", "リップル: オフ", "리플: 끔"),
    "mobile_ripple_track":      ("波纹:轨", "波紋:軌", "Ripple: Track", "リップル: トラック", "리플: 트랙"),
    "mobile_ripple_all":        ("波纹:全", "波紋:全", "Ripple: All", "リップル: すべて", "리플: 전체"),
    "mobile_metronome":         ("节拍器", "節拍器", "Metronome", "メトロノーム", "메트로놈"),
    "mobile_grid":              ("网格", "網格", "Grid", "グリッド", "그리드"),
    "mobile_auto_crossfade":    ("自动交叉", "自動交叉", "Auto crossfade", "自動クロスフェード", "자동 크로스페이드"),
    "mobile_split_transition":  ("分割过渡", "分割過渡", "Split transition", "分割トランジション", "분할 전환"),
    "mobile_playhead_zoom":     ("播放头缩放", "播放頭縮放", "Playhead zoom", "再生ヘッドズーム", "재생 헤드 확대"),
    "mobile_auto_scroll":       ("自动滚动", "自動捲動", "Auto scroll", "自動スクロール", "자동 스크롤"),
    "mobile_param_follow":      ("参数跟随", "參數跟隨", "Follow params", "パラメータ追従", "파라미터 추적"),
    "mobile_timeline_switch":   ("时间轴换轨", "時間軸換軌", "Switch timeline track", "タイムラインのトラック切替", "타임라인 트랙 전환"),
    "mobile_ignore_grouping":   ("忽略编组", "忽略編組", "Ignore grouping", "グループを無視", "그룹 무시"),
    "mobile_more_switches":     ("更多开关", "更多開關", "More toggles", "その他の切替", "추가 토글"),
    "mobile_params_overlays":   ("参数与覆盖层", "參數與覆蓋層", "Params & overlays", "パラメータとオーバーレイ", "파라미터 및 오버레이"),
    # ── 走带控制 ─────────────────────────────────────────────────────────
    "mobile_undo":              ("撤销", "復原", "Undo", "元に戻す", "실행 취소"),
    "mobile_redo":              ("重做", "重做", "Redo", "やり直す", "다시 실행"),
    "mobile_stop":              ("停止", "停止", "Stop", "停止", "정지"),
    "mobile_play":              ("播放", "播放", "Play", "再生", "재생"),
    "mobile_pause":             ("暂停", "暫停", "Pause", "一時停止", "일시정지"),
    "mobile_record":            ("录制", "錄製", "Record", "録音", "녹음"),
    "mobile_stop_recording":    ("停止录制", "停止錄製", "Stop recording", "録音停止", "녹음 정지"),
    # ── 参数工具行 ────────────────────────────────────────────────────────
    "mobile_select":            ("选择", "選擇", "Select", "選択", "선택"),
    "mobile_param_toolbar":     ("参数工具行", "參數工具列", "Param toolbar", "パラメータツールバー", "파라미터 도구 모음"),
    "mobile_param_menu":        ("参数菜单", "參數選單", "Param menu", "パラメータメニュー", "파라미터 메뉴"),
    "mobile_bottom_bar":        ("底部工具条", "底部工具列", "Bottom toolbar", "下部ツールバー", "하단 도구 모음"),
    # ── 👁 菜单的状态与动作 ────────────────────────────────────────────────
    "mobile_showing":           ("显示中", "顯示中", "Shown", "表示中", "표시 중"),
    "mobile_hidden":            ("已隐藏", "已隱藏", "Hidden", "非表示", "숨김"),
    "mobile_synced":            ("已同步", "已同步", "Synced", "同期済み", "동기화됨"),
    "mobile_not_synced":        ("未同步", "未同步", "Not synced", "未同期", "동기화 안 됨"),
    "mobile_switch_to":         ("切换到", "切換到", "Switch to", "切替", "전환"),
    "mobile_hide_curve":        ("隐藏该参数曲线", "隱藏該參數曲線", "Hide this parameter curve", "このパラメータ曲線を隠す", "이 파라미터 곡선 숨기기"),
    "mobile_show_curve":        ("显示该参数曲线", "顯示該參數曲線", "Show this parameter curve", "このパラメータ曲線を表示", "이 파라미터 곡선 표시"),
    "mobile_breath_off":        ("关闭气声", "關閉氣聲", "Turn breath off", "気息をオフ", "숨소리 끄기"),
    "mobile_breath_on":         ("开启气声", "開啟氣聲", "Turn breath on", "気息をオン", "숨소리 켜기"),
}

LOCALES = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"]
EXPORT_NAMES = {
    "zh-CN": "zhCN", "zh-TW": "zhTW", "en-US": "enUS", "ja-JP": "jaJP", "ko-KR": "koKR",
}

# 组件里要替换的硬编码 → 键名。只替换**带 `label=` / `label:` / `aria-label=` 前缀**的，
# 避免误伤注释里的同名文字（注释里"绘制""录制"大量出现，正则放宽会毁掉注释）。
REPLACEMENTS = {
    "MobileBottomBar.tsx": [
        (r'label="关闭浮层"', 'label={t("mobile_close_overlay")}'),
        (r'label="关闭工具菜单"', 'label={t("mobile_close_tool_menu")}'),
        (r'label="关闭参数菜单"', 'label={t("mobile_close_tool_menu")}'),
        (r'label="绘制工具"', 'label={t("mobile_tool_menu")}'),
        (r'label="参数与覆盖层"', 'label={t("mobile_params_overlays")}'),
        (r'label="参数工具行"', 'label={t("mobile_param_toolbar")}'),
        (r'label="参数菜单"', 'label={t("mobile_param_menu")}'),
        (r'label="底部工具条"', 'label={t("mobile_bottom_bar")}'),
        (r'label: "绘制"(,| )', r'label: t("mobile_tool_draw")\1'),
        (r'label: "颤音"', 'label: t("mobile_tool_vibrato")'),
        (r'label: "节拍器"', 'label: t("mobile_metronome")'),
        (r'label: "网格"', 'label: t("mobile_grid")'),
        (r'label: "自动交叉"', 'label: t("mobile_auto_crossfade")'),
        (r'label: "分割过渡"', 'label: t("mobile_split_transition")'),
        (r'label: "播放头缩放"', 'label: t("mobile_playhead_zoom")'),
        (r'label: "自动滚动"', 'label: t("mobile_auto_scroll")'),
        (r'label: "参数跟随"', 'label: t("mobile_param_follow")'),
        (r'label: "时间轴换轨"', 'label: t("mobile_timeline_switch")'),
        (r'label: "忽略编组"', 'label: t("mobile_ignore_grouping")'),
        (r'label="更多开关"', 'label={t("mobile_more_switches")}'),
        (r'label="撤销"', 'label={t("mobile_undo")}'),
        (r'label="重做"', 'label={t("mobile_redo")}'),
        (r'label="停止"', 'label={t("mobile_stop")}'),
        (r'label="播放"', 'label={t("mobile_play")}'),
        (r'label="选择"', 'label={t("mobile_select")}'),
        (r'label="绘制"', 'label={t("mobile_tool_draw")}'),
        (r'label={isPlaying \? "暂停" : "播放"\}',
         'label={isPlaying ? t("mobile_pause") : t("mobile_play")}'),
        (r'label={recording\.active \? "停止录制" : "录制"\}',
         'label={recording.active ? t("mobile_stop_recording") : t("mobile_record")}'),
        (r'title="更多开关"', 'title={t("mobile_more_switches")}'),
        (r'"波纹:关"', 't("mobile_ripple_off")'),
        (r'"波纹:轨"', 't("mobile_ripple_track")'),
        (r'"波纹:全"', 't("mobile_ripple_all")'),
        (r'"显示中"', 't("mobile_showing")'),
        (r'"已隐藏"', 't("mobile_hidden")'),
        (r'"已同步"', 't("mobile_synced")'),
        (r'"未同步"', 't("mobile_not_synced")'),
        (r'"切换到"', 't("mobile_switch_to")'),
        (r'\bvisible \? "隐藏该参数曲线" : "显示该参数曲线"',
         'visible ? t("mobile_hide_curve") : t("mobile_show_curve")'),
        (r'\bon \? "关闭气声" : "开启气声"',
         'on ? t("mobile_breath_off") : t("mobile_breath_on")'),
    ],
    "BottomTabs.tsx": [],
}


def build_block(locale: str) -> str:
    idx = LOCALES.index(locale)
    lines = ["    // ── 移动端外壳（fork 新增，2026-09-22）── 键名以 mobile_ 开头", ""]
    for key, vals in KEYS.items():
        lines.append(f'    {key}: "{vals[idx]}",')
    return "\n".join(lines) + "\n"


def patch_i18n(apply: bool) -> int:
    changed = 0
    for loc in LOCALES:
        f = I18N / f"{loc}.ts"
        text = f.read_text(encoding="utf-8")
        if "mobile_tab_timeline:" in text:
            print(f"  · {loc}.ts 已含移动端键，跳过")
            continue
        anchor = "\n} as const;"
        if anchor not in text:
            print(f"  ✗ {loc}.ts 找不到 `}} as const;` 收尾，跳过")
            continue
        new = text.replace(anchor, "\n" + build_block(loc) + anchor, 1)
        if apply:
            f.write_text(new, encoding="utf-8")
        print(f"  ✓ {loc}.ts  +{len(KEYS)} 键")
        changed += 1
    return changed


def patch_component(name: str, apply: bool) -> int:
    f = MOBILE / name
    text = f.read_text(encoding="utf-8")
    total = 0
    for pat, rep in REPLACEMENTS[name]:
        new, n = re.subn(pat, rep, text)
        if n:
            print(f"    {name}: {pat[:46]:<46} ×{n}")
            text = new
            total += n
    if apply and total:
        f.write_text(text, encoding="utf-8")
    return total


def main() -> int:
    apply = "--apply" in sys.argv
    print("模式：" + ("写入" if apply else "试运行（加 --apply 才真写）"))
    print("\n① 给语种文件加键")
    n = patch_i18n(apply)
    print(f"\n② 替换组件硬编码")
    for name in REPLACEMENTS:
        c = patch_component(name, apply)
        print(f"  {name}：{c} 处")
    print(f"\n合计：{n} 个语种文件、{sum(patch_component(k, False) for k in REPLACEMENTS)} 处组件替换")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
