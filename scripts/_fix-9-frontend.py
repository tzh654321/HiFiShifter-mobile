#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 第四步：前端 —— 取「关联文件」路径并送进导入流程。

## 落点

- API 层 `services/api/project.ts`：加 `takePendingOpenFile()`（与 `openProjectDialog` 同款）；
- `App.tsx`：挂载后 + 从后台恢复（`visibilitychange`）时各取一次；
  拿到路径按**扩展名**分发：
  · `.hshp/.hsp/.hshp-bak/.hsp-bak/.json` ⇒ 走 `openProjectFromPath`（**现成的 thunk**）；
  · 其余 ⇒ 暂时只记日志（音频导入流程另议，用户最常用的是工程文件）。

⚠️ 只在 **Android** 上调：桌面端该命令恒返回 `{"ok":true,"path":null}`，
调了也无害，但没必要多一次 IPC。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
SRC = ROOT / "upstream-src" / "frontend" / "src"

# ── ① API ────────────────────────────────────────────────────────────────
API = SRC / "services" / "api" / "project.ts"
t = API.read_text(encoding="utf-8")
anchor = """    openProjectDialog: () =>"""
addition = """    /** HS-OPEN-WITH-PATCH —— 取一次「用本应用打开」的文件路径（取一次即清）。 */
    takePendingOpenFile: () =>
        invoke<{ ok: boolean; path: string | null; error?: string }>("take_pending_open_file"),
    openProjectDialog: () =>"""
assert t.count(anchor) == 1, f"① 锚命中 {t.count(anchor)}"
t = t.replace(anchor, addition, 1)
API.write_text(t, encoding="utf-8")
print("✓ ① project.ts 加了 takePendingOpenFile")

# ── ② App.tsx ────────────────────────────────────────────────────────────
APP = SRC / "App.tsx"
a = APP.read_text(encoding="utf-8")

anchor2 = """    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobilePanelKey }>).detail?.tab;"""

addition2 = """    /**
     * HS-OPEN-WITH-PATCH —— 关联文件（其他应用里对本软件的文件点「打开」）。
     *
     * `MainActivity` 已把 URI 物化到 cacheDir 并记下（`HifishifterFs.acceptOpenIntent`），
     * 这里取一次；Kotlin 侧取一次即清，所以可以在启动与恢复时都调。
     *
     * 工程文件直接走现成的 `openProjectFromPath`；音频文件暂只记日志
     * （导入流程有多个分支，另议 —— 用户最常用的是 `.hshp`）。
     */
    useEffect(() => {
        if (!isTouchShell) return;
        const PROJECT_EXT = /\\\\.(hshp|hsp|hshp-bak|hsp-bak|json)$/i;
        let busy = false;
        const check = async () => {
            if (busy) return;
            busy = true;
            try {
                const r = await projectApi.takePendingOpenFile();
                const path = r?.path ?? null;
                if (!r?.ok || !path) return;
                console.info("[open-with] 收到关联文件：", path);
                if (PROJECT_EXT.test(path)) {
                    await dispatch(openProjectFromPath(path));
                } else {
                    // 音频等其它类型：导入入口分支较多，先留痕（后续按需接入）。
                    console.info("[open-with] 非工程文件，暂未接入导入流程：", path);
                }
            } catch (err) {
                console.warn("[open-with] 取关联文件失败：", err);
            } finally {
                busy = false;
            }
        };
        void check(); // 冷启动
        const onVisible = () => {
            if (document.visibilityState === "visible") void check();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [dispatch, isTouchShell]);

    useEffect(() => {
        const onSwitch = (e: Event) => {
            const tab = (e as CustomEvent<{ tab?: MobilePanelKey }>).detail?.tab;"""

assert a.count(anchor2) == 1, f"② 锚命中 {a.count(anchor2)}"
a = a.replace(anchor2, addition2, 1)
APP.write_text(a, encoding="utf-8")
print("✓ ② App.tsx 加了关联文件检查（启动 + 恢复）")
print("  ⚠ 需要确认 projectApi / openProjectFromPath 已在 App.tsx 的 import 里")
