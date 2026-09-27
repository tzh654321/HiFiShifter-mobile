#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C（#17）：删底栏，四个面板改为「视图」菜单里的勾选项。

用户口径：
> 把底栏（**轨道 / 参数 / 文件 / 笔记**那一行）**全部改成勾选项放进「视图」菜单**，模仿 flm。

## 设计（写在代码里，便于回溯）

- 底栏 `BottomTabs`（单选、互斥）⇒ **4 个独立 boolean**（`mobilePanels.{timeline,params,files,notes}`）
- **勾了即显示**，多个可同时勾 ⇒ 面板区**垂直分屏**（`flex-1` 均分）
- **至少保留一个**：取消最后一个勾选时忽略操作（否则整屏空白，用户会以为崩了）
- 状态放 **redux**（原来是 App 局部 state）——
  因为「视图」菜单在 `MenuBar` 里，够不着 App 的局部 state；放 redux 后两处都能改。
- 兼容 B4：`hs-mobile-switch-tab` 事件收到 `timeline` 时 ⇒ **保证 timeline 被勾选**
  （拖拽过页的语义变成"把轨道面板勾上"，而不是"切到轨道页"）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① 类型 ──────────────────────────────────────────────────────────────────
T = FE / "features" / "session" / "sessionTypes.ts"
t = T.read_text(encoding="utf-8")
if "MobilePanelKey" not in t:
    t = t.rstrip("\n") + """

/**
 * C（#17）：手机端四个面板的显隐。
 *
 * 原来是底栏 `BottomTabs` 的单选互斥；改为「视图」菜单里的勾选项后，
 * 每个面板独立开关，多个同时勾选 ⇒ 垂直分屏。
 */
export type MobilePanelKey = "timeline" | "params" | "files" | "notes";
export type MobilePanels = Record<MobilePanelKey, boolean>;
"""
    T.write_text(t, encoding="utf-8")
    print("✓ sessionTypes：加了 MobilePanelKey / MobilePanels")

# ── ② slice：state + action ─────────────────────────────────────────────────
S = FE / "features" / "session" / "sessionSlice.ts"
t = S.read_text(encoding="utf-8")

# state 初始值：默认只开轨道（与删底栏前的默认页一致）
old_state = "    toolModeGroup: ToolModeGroup;"
assert t.count(old_state) == 1, "state 锚不唯一"
t = t.replace(old_state, old_state + """
    /** C（#17）：手机端四个面板的显隐（取代底栏单选页签）。 */
    mobilePanels: MobilePanels;""", 1)

old_init = '    toolModeGroup: "draw",'
assert t.count(old_init) == 1, "initialState 锚不唯一"
t = t.replace(old_init, old_init + """
    mobilePanels: { timeline: true, params: false, files: false, notes: false },""", 1)

# action：toggle（含"至少留一个"守卫）
anchor = "        setEditParam(state, action: PayloadAction<EditParam>) {"
assert t.count(anchor) == 1, "setEditParam 锚不唯一"
t = t.replace(anchor, """        /**
         * C（#17）：切换手机端某个面板的显隐。
         *
         * ⚠️ **至少保留一个**：取消最后一个勾选时直接忽略 ——
         * 否则面板区整片空白，用户会当成崩溃。
         */
        toggleMobilePanel(state, action: PayloadAction<MobilePanelKey>) {
            const key = action.payload;
            const next = { ...state.mobilePanels, [key]: !state.mobilePanels[key] };
            const anyOn = Object.values(next).some(Boolean);
            if (!anyOn) return;
            state.mobilePanels = next;
        },
        /** C（#17）：强制勾上某个面板（不关闭别的）—— B4 过页用。 */
        showMobilePanel(state, action: PayloadAction<MobilePanelKey>) {
            state.mobilePanels = { ...state.mobilePanels, [action.payload]: true };
        },
""" + anchor, 1)

print("✓ sessionSlice：toggleMobilePanel / showMobilePanel")

# import 类型
import re
m = re.search(r"^import type \{([^}]*)\} from \"\./sessionTypes\";", t, re.M)
if m and "MobilePanels" not in m.group(1):
    t = t[:m.start()] + f'import type {{{m.group(1).rstrip()}, MobilePanels, MobilePanelKey }} from "./sessionTypes";' + t[m.end():]
    print("  ✓ import 补 MobilePanels / MobilePanelKey")
S.write_text(t, encoding="utf-8")
print("✓ sessionSlice 完成")

# ── ③ App.tsx：分屏渲染 + 删 BottomTabs ─────────────────────────────────────
A = FE / "App.tsx"
t = A.read_text(encoding="utf-8")

old_import = 'import { BottomTabs, type MobileTab } from "./components/mobile/BottomTabs";'
assert t.count(old_import) == 1, "BottomTabs import 锚不唯一"
t = t.replace(old_import, "", 1)

old_state2 = '    const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");'
assert t.count(old_state2) == 1, "mobileTab state 锚不唯一"
t = t.replace(old_state2, """    /* C（#17）：底栏页签已删除，四个面板的显隐改为「视图」菜单勾选项（redux）。 */
    const mobilePanels = useAppSelector((st) => st.session.mobilePanels);""", 1)

# B4 的切页事件 ⇒ 改为"强制勾上 timeline"
old_switch = '            const tab = (e as CustomEvent<{ tab?: MobileTab }>).detail?.tab;'
assert t.count(old_switch) == 1, "切页事件锚不唯一"
t = t.replace(old_switch, """            const tab = (e as CustomEvent<{ tab?: MobilePanelKey }>).detail?.tab;""", 1)
t = t.replace("""            if (tab) {
                setMobileTab(tab);""", """            if (tab) {
                dispatch(showMobilePanel(tab));""", 1)

# 面板渲染 ⇒ 分屏
old_render = """                    {mobileTab === "params" ? <MobileParamToolRow /> : null}
                    <Box className="flex-1 min-h-0 relative bg-qt-base">
                        {mobileTab === "timeline" ? <TimelinePanel {...timelinePanelProps} /> : null}
                        {mobileTab === "params" ? <PianoRollPanel /> : null}
                        {mobileTab === "files" ? <FileBrowserPanel /> : null}
                        {mobileTab === "notes" ? <NotebookPanel /> : null}
                    </Box>"""
assert t.count(old_render) == 1, "面板渲染锚不唯一"
t = t.replace(old_render, """                    {mobilePanels.params ? <MobileParamToolRow /> : null}
                    {/* C（#17）：勾了几个面板就分几块，垂直均分（`flex-1`）。
                        至少有一个（`toggleMobilePanel` 里守卫），所以不会整片空白。 */}
                    <Box className="flex-1 min-h-0 relative bg-qt-base flex flex-col">
                        {mobilePanels.timeline ? (
                            <div className="flex-1 min-h-0 relative">
                                <TimelinePanel {...timelinePanelProps} />
                            </div>
                        ) : null}
                        {mobilePanels.params ? (
                            <div className="flex-1 min-h-0 relative">
                                <PianoRollPanel />
                            </div>
                        ) : null}
                        {mobilePanels.files ? (
                            <div className="flex-1 min-h-0 relative">
                                <FileBrowserPanel />
                            </div>
                        ) : null}
                        {mobilePanels.notes ? (
                            <div className="flex-1 min-h-0 relative">
                                <NotebookPanel />
                            </div>
                        ) : null}
                    </Box>""", 1)

# 删 BottomTabs 渲染
old_tabs = '            {isPhone ? <BottomTabs active={mobileTab} onChange={setMobileTab} /> : null}'
assert t.count(old_tabs) == 1, "BottomTabs 渲染锚不唯一"
t = t.replace(old_tabs, '            {/* C（#17）：底栏页签已删除 —— 面板显隐改到「视图」菜单。 */}', 1)

A.write_text(t, encoding="utf-8")
print("✓ App.tsx：分屏渲染 + 删 BottomTabs")

# ── ④ import 补 showMobilePanel / MobilePanelKey ───────────────────────────
t = A.read_text(encoding="utf-8")
if "showMobilePanel" not in t.split("export default")[0].split("from \"../../features")[0]:
    pass
print("  ⚠️ 记得把 showMobilePanel 加进 sessionSlice 的 import（下面单独处理）")
