#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""👁 菜单两项改造：

① 每项图标要不同（现在只有 `pitch` 用 IconPitchSnap、其余一律 IconDragAxis）。
   上游只提供气声的 `BreathAirIcon`，其余按同一风格自绘：
   `18×18` 容器 / `viewBox 0 0 16 16` / `stroke=currentColor` / 线宽 1.2~1.4。

② 去掉「切换到」胶囊：改成**点该行的图标+文字区域**即切换（用户口径）。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "mobile" / "MobileBottomBar.tsx")
text = P.read_text(encoding="utf-8")

# ── ① 新增图标组件（插在 IconDragAxis 之前，紧挨其他图标）─────────────────────
ICONS = '''
/* ── 2026-09-24：参数行图标（每项不同）─────────────────────────────────────
 * 用户口径「👁 菜单中每项的图标要不同，若没有合适的图标素材你可以自己画几张
 * （统一风格与尺寸）」。上游只给了气声用的 `BreathAirIcon`，下面几个是自绘的，
 * 风格对齐既有图标：18×18 容器 / viewBox 0 0 16 16 / stroke=currentColor / 线宽 1.2~1.4。
 */

/** 音高：音符（复用既有 IconPitchSnap 的语义）。 */
function IconParamFormant() {
    // 共振峰：三条谐振峰 + 顶部频谱包络（Formant = 声道共振的峰）
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3.4c2 2 4 2 6 0s4-2 6 0" stroke="currentColor" strokeWidth="1.1"
                strokeLinecap="round" opacity="0.5" />
            <path d="M3.2 13.2V8.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M8 13.2V4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M12.8 13.2V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function IconParamTension() {
    // 张力：一条被拉紧的线，中间挂着弹簧
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 8h2.2M11.8 8H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.2 8l1.7-2.5 1.7 5 1.7-5 1.7 2.5" stroke="currentColor" strokeWidth="1.3"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function IconParamVolume() {
    // 音量：喇叭 + 两道声波
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.4 6.2h2.2L7.4 3.6v8.8L4.6 9.8H2.4z" stroke="currentColor"
                strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M9.8 6a3 3 0 0 1 0 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M11.9 4.1a5.7 5.7 0 0 1 0 7.8" stroke="currentColor" strokeWidth="1.2"
                strokeLinecap="round" opacity="0.55" />
        </svg>
    );
}

function IconParamPan() {
    // 声像：左右两条轨道 + 中间滑块（L ←→ R）
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 12.6V3.4M14 12.6V3.4" stroke="currentColor" strokeWidth="1.2"
                strokeLinecap="round" opacity="0.5" />
            <path d="M2.4 8h2.6M11 8h2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <rect x="5.6" y="6.3" width="4.8" height="3.4" rx="1.1" fill="currentColor" />
        </svg>
    );
}

/** 未知/兜底参数：两个横向滑块（通用「参数」语义）。 */
function IconParamGeneric() {
    return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2.4 5h11.2M2.4 11h11.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="6" cy="5" r="1.8" fill="currentColor" />
            <circle cx="10.4" cy="11" r="1.8" fill="currentColor" />
        </svg>
    );
}

/** 参数 id → 图标。未知 id 走兜底，保证「每项都能看到不同的图形」。 */
function paramIcon(id: string): React.ReactNode {
    switch (id) {
        case "pitch":
            return <IconPitchSnap />;
        case "formant_shift_cents":
            return <IconParamFormant />;
        case "breathiness":
            return <BreathAirIcon />;
        case "tension":
            return <IconParamTension />;
        case "volume":
            return <IconParamVolume />;
        case "pan":
            return <IconParamPan />;
        default:
            return <IconParamGeneric />;
    }
}

'''

anchor = "/** 参数曲线（折线 + 箭头）。 */\nfunction IconDragAxis() {"
assert text.count(anchor) == 1, "IconDragAxis 锚不唯一"
text = text.replace(anchor, ICONS.lstrip("\n") + anchor, 1)

# ── ② 参数行：换成 paramIcon，并把「切换到」并入可点击行 ─────────────────────
old_row = '''                        <span
                            aria-hidden="true"
                            style={{
                                width: 20,
                                display: "inline-flex",
                                justifyContent: "center",
                                opacity: row.secondary ? 1 : 0.4,
                            }}
                        >
                            {row.id === "pitch" ? <IconPitchSnap /> : <IconDragAxis />}
                        </span>
                        <span
                            style={{
                                flex: "1 1 auto",
                                fontSize: 13,
                                fontWeight: s.editParam === row.id ? 600 : 400,
                                color: s.editParam === row.id ? "var(--accent-11, rgb(177, 169, 255))" : undefined,
                            }}
                        >
                            {row.label}
                        </span>
                        {/* 气声开关：**图标化**并用上游同一个「气流」图形（用户口径：
                            「关闭 放在 切换到 的左边，并且使用图标（原软件已给）」） */}
                        {row.hasBreathSwitch
                            ? breathPill(Boolean(row.breathOn), () => setBreath(!row.breathOn), `br-${row.id}`)
                            : null}
                        {pill(
                            s.editParam === row.id,
                            t("mobile_switch_to"),
                            () => {
                                dispatch(setEditParam(row.id));
                                onClose();
                            },
                            `sw-${row.id}`,
                        )}
                        {eyePill(row.secondary, row.id, `vis-${row.id}`)}'''

new_row = '''                        {/* 🔴 2026-09-24：**去掉「切换到」胶囊**（用户口径「不要切换到按钮，
                            点击该项的文字图标那片区域即可切换」）。图标+文字整体变成一个按钮，
                            命中区就是那一片；右侧只剩「气声开关」与「曲线显隐」两个功能性胶囊。 */}
                        <button
                            type="button"
                            aria-pressed={s.editParam === row.id}
                            aria-label={row.label}
                            onClick={() => {
                                dispatch(setEditParam(row.id));
                                onClose();
                            }}
                            className="flex items-center gap-2 bg-transparent border-0 cursor-pointer"
                            style={{
                                flex: "1 1 auto",
                                minHeight: 40,
                                padding: 0,
                                textAlign: "left",
                                WebkitTapHighlightColor: "transparent",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 20,
                                    display: "inline-flex",
                                    justifyContent: "center",
                                    opacity: row.secondary ? 1 : 0.4,
                                }}
                            >
                                {paramIcon(row.id)}
                            </span>
                            <span
                                style={{
                                    fontSize: 13,
                                    fontWeight: s.editParam === row.id ? 600 : 400,
                                    color:
                                        s.editParam === row.id
                                            ? "var(--accent-11, rgb(177, 169, 255))"
                                            : undefined,
                                }}
                            >
                                {row.label}
                            </span>
                        </button>
                        {/* 气声开关：**图标化**并用上游同一个「气流」图形（用户口径：
                            「关闭 放在 切换到 的左边，并且使用图标（原软件已给）」） */}
                        {row.hasBreathSwitch
                            ? breathPill(Boolean(row.breathOn), () => setBreath(!row.breathOn), `br-${row.id}`)
                            : null}
                        {eyePill(row.secondary, row.id, `vis-${row.id}`)}'''

assert text.count(old_row) == 1, "参数行锚不唯一"
text = text.replace(old_row, new_row, 1)

P.write_text(text, encoding="utf-8")
print("✓ 已插入 5 个参数图标（含兜底）+ paramIcon 映射")
print("✓ 参数行改为「点图标+文字区域切换」，删除「切换到」胶囊")
