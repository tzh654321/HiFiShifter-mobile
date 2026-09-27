#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#49 顶栏「轨道」菜单对齐长按轨道头菜单（改用 `sub` 做算法子菜单）。

## 对比（查过源码）

| 长按轨道头（`TrackList.tsx:2269+`）| 顶栏「轨道」原有 |
| :--- | :--- |
| `track_add` 添加轨道 | ✅ |
| `track_clone` 克隆 | ✅ |
| `ctx_delete` 删除 | ✅ |
| `ctx_rename` **重命名** | ❌ 缺 |
| 算法（world / nsf-hifigan / vslib / 无）| ❌ 缺 |

## 落点

- **算法**：`TimelinePanel.tsx:5548` 的 `handleTrackAlgoChange`
  = `dispatch(setTrackStateRemote({ trackId, pitchAnalysisAlgo: algo }))`
  ⇒ `MobileTopBar` **直接调同一个 action**，不穿 props。
- **重命名**：「进入行内编辑态」是 `TrackList` 的局部 state ⇒
  派发 `hs-rename-track` 事件，由 `TrackList` 监听（沿用本文件既有的
  `hs-mobile-switch-tab` 事件桥模式）。

⚠️ `MenuEntry` **没有 `isHeader`**（只有 label / action / sep / checked / sub）
⇒ 算法做成 **`sub` 二级面板**（项目里「导入工程」「主题」都这么写），
而不是平铺 4 行 —— 这样也不会把一级菜单撑得比长按菜单长太多。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "upstream-src" / "frontend" / "src"
MT = SRC / "components" / "mobile" / "MobileTopBar.tsx"
t = MT.read_text(encoding="utf-8")

old = """        menu_track: [
            { label: t("track_add"), action: () => void dispatch(addTrackRemote({})) },
            {
                label: tAny("menu_clone_selected_track"),
                // 没有选中轨道时后端不接受，置灰（与原软件一致）
                action: selectedTrackId
                    ? () => void dispatch(duplicateTrackRemote(selectedTrackId))
                    : undefined,
            },
            {
                label: t("track_remove_selected"),
                // 没有选中轨道时不做任何事（后端也不接受空 id）。
                action: selectedTrackId
                    ? () => void dispatch(removeTrackRemote(selectedTrackId))
                    : undefined,
            },
        ],"""

new = """        /* #49：顶栏「轨道」菜单要与**长按轨道头**的菜单一致（用户口径）。
         *
         * 长按菜单（`TrackList.tsx:2269+`）：添加轨道 / 克隆 / 删除 ─── 重命名 ─── 算法
         * 顶栏原本缺 **重命名** 与 **算法**，这里补齐。
         */
        menu_track: (() => {
            const cur = s.tracks?.find((tr) => tr.id === selectedTrackId);
            /* 算法只对「根轨 + 已开 Compose」有意义 —— 与长按菜单的判据一致
             * （见TrackList 里 `ctxIsRoot` / `ctxComposeEnabled`）。 */
            const algoUsable = Boolean(cur && (cur.parentId ?? null) == null && cur.composeEnabled);
            const ALGOS: ReadonlyArray<[string, string]> = [
                ["world_dll", "world"],
                ["nsf_hifigan_onnx", "nsf-hifigan"],
                ["vslib", "vslib"],
                ["none", t("none")],
            ];
            const items: MenuEntry[] = [
                { label: t("track_add"), action: () => void dispatch(addTrackRemote({})) },
                {
                    label: t("track_clone"),
                    // 没有选中轨道时后端不接受，置灰（与原软件一致）
                    action: selectedTrackId
                        ? () => void dispatch(duplicateTrackRemote(selectedTrackId))
                        : undefined,
                },
                {
                    label: t("ctx_delete"),
                    // 没有选中轨道时不做任何事（后端也不接受空 id）。
                    action: selectedTrackId
                        ? () => void dispatch(removeTrackRemote(selectedTrackId))
                        : undefined,
                },
                { sep: true, label: "" },
                {
                    label: t("ctx_rename"),
                    /* 「进入行内编辑态」是 TrackList 的局部 state，顶栏够不着
                     * ⇒ 走 window 事件桥（与 `hs-mobile-switch-tab` 同一套路）。 */
                    action: selectedTrackId
                        ? () =>
                              window.dispatchEvent(
                                  new CustomEvent("hs-rename-track", {
                                      detail: { trackId: selectedTrackId },
                                  }),
                              )
                        : undefined,
                },
            ];
            if (algoUsable && cur) {
                items.push({ sep: true, label: "" });
                items.push({
                    label: `${t("algo_label")} (${ALGOS.find(([v]) => (cur.pitchAnalysisAlgo ?? "nsf_hifigan_onnx") === v)?.[1] ?? ""})`,
                    sub: ALGOS.map(([value, label]) => ({
                        label,
                        checked: (cur.pitchAnalysisAlgo ?? "nsf_hifigan_onnx") === value,
                        action: () =>
                            void dispatch(
                                setTrackStateRemote({
                                    trackId: cur.id,
                                    pitchAnalysisAlgo: value,
                                }),
                            ),
                    })),
                });
            }
            return items;
        })(),"""

assert t.count(old) == 1, f"锚命中 {t.count(old)}"
t = t.replace(old, new, 1)
print("✓ menu_track 已补齐（重命名 + 算法子菜单）")

# 补 import
if "setTrackStateRemote" not in t:
    old_imp = 'import { addTrackRemote, removeTrackRemote } from "../../features/session/thunks/timelineThunks";'
    new_imp = ('import {\n'
               '    addTrackRemote,\n'
               '    removeTrackRemote,\n'
               '    /* #49：算法变更沿用 TimelinePanel 的同一个 action，直接调、不穿 props。 */\n'
               '    setTrackStateRemote,\n'
               '} from "../../features/session/thunks/timelineThunks";')
    assert t.count(old_imp) == 1, "import 锚未命中"
    t = t.replace(old_imp, new_imp, 1)
    print("✓ 补 setTrackStateRemote import")

MT.write_text(t, encoding="utf-8")
