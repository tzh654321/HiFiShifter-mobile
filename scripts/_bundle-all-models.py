#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#4 全模型随包 + 隐藏「模型管理」入口。

用户口径：「目前只制作安装时就带所有模型的版本（或打开时就自动从安装包里提取模型安装），
可以隐藏模型管理设置」。

现状（ADR-012 减包后）：APK 只带 `nsf_hifigan`（56.6 MB），
`hnsep`（92.6 MB）/ `fcpe`（43.3 MB）走「下载 / 本地导入」双通道。
两个模型文件**一直在源码树里**（`resources/models/`），只是从 bundle 配置里摘掉了。

⇒ 把 android conf 的 `bundle.resources` 补回那三条即可。
**不用改 `build-apk.sh §⑤.5`** —— 那段是按 conf 文本 grep 出「期望目录」再清 assets 的，
加回配置后它自动就对（这正是当初把它写成"从 conf 推导"而不是硬编码清单的价值）。

代价：APK 163 MB → **约 306 MB**。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "upstream-src" / "backend" / "src-tauri"
FE = ROOT / "upstream-src" / "frontend" / "src"

# ── ① android conf：补回 hnsep / fcpe ───────────────────────────────────────
CFG = SRC / "tauri.android.conf.json"
cfg = json.loads(CFG.read_text(encoding="utf-8"))
res = cfg["bundle"]["resources"]
want = {
    "resources/models/nsf_hifigan/pc_nsf_hifigan.onnx": "models/nsf_hifigan/pc_nsf_hifigan.onnx",
    "resources/models/hnsep/hnsep.onnx": "models/hnsep/hnsep.onnx",
    "resources/models/hnsep/config.yaml": "models/hnsep/config.yaml",
    "resources/models/fcpe/fcpe.onnx": "models/fcpe/fcpe.onnx",
}
added = []
for k, v in want.items():
    if k not in res:
        res[k] = v
        added.append(k)
cfg["bundle"]["resources"] = res
CFG.write_text(json.dumps(cfg, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"✓ tauri.android.conf.json：新增 {len(added)} 条资源")
for k in added:
    print(f"    + {k}")

# ── ② 隐藏「模型管理」入口（两处渲染路径都要）────────────────────────────────
# 说明：phone 用 MobileTopBar、桌面/平板用 MenuBar —— 又是"两套实现"，
# 上次 #15 就是只改了一边，这次两边一起改。
FLAG = "HS_MODELS_BUNDLED"

mb = FE / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")
old = """                    <DropdownMenu.Item onSelect={() => setModelManagerOpen(true)}>
                        模型管理…
"""
new = """                    {/* #4：模型已随包（hnsep/fcpe/nsf_hifigan 全在内置 conf 里），
                        用户口径「可以隐藏模型管理设置」⇒ 不再暴露入口。
                        留 HS_MODELS_BUNDLED 便于以后需要时切回。 */}
                    {!HS_MODELS_BUNDLED && (
                        <DropdownMenu.Item onSelect={() => setModelManagerOpen(true)}>
                            模型管理…
"""
if old in t:
    t = t.replace(old, new, 1)
    # 补上闭合括号（原 </DropdownMenu.Item> 之后）
    t = t.replace(new + "                        </DropdownMenu.Item>\n", new + "                        </DropdownMenu.Item>\n                    )}\n", 1)
    # 定义常量（文件顶部 import 之后）
    if FLAG not in t.split("export")[0]:
        anchor = 'import { ModelManagerDialog } from "./ModelManagerDialog";'
        if anchor in t:
            t = t.replace(anchor, anchor + f"\n\n/** #4：模型是否全部随包（true ⇒ 隐藏「模型管理」入口）。 */\nconst {FLAG} = true;", 1)
    mb.write_text(t, encoding="utf-8")
    print("✓ MenuBar.tsx：模型管理入口已按 HS_MODELS_BUNDLED 隐藏")
else:
    print("  · MenuBar.tsx：锚未命中（可能已改过）")

# 手机端：MobileTopBar 的菜单项数组里那一条
mt = FE / "components" / "mobile" / "MobileTopBar.tsx"
t = mt.read_text(encoding="utf-8")
old2 = '{ label: "模型管理…", action: () => setModelManagerOpen(true) }'
if old2 in t:
    t = t.replace(old2, f'...(HS_MODELS_BUNDLED ? [] : [{{ label: "模型管理…", action: () => setModelManagerOpen(true) }}])', 1)
    if FLAG not in t:
        anchor = 'import { ModelManagerDialog } from "../layout/ModelManagerDialog";'
        if anchor in t:
            t = t.replace(anchor, anchor + f"\n\n/** #4：模型是否全部随包（true ⇒ 隐藏「模型管理」入口）。 */\nconst {FLAG} = true;", 1)
    mt.write_text(t, encoding="utf-8")
    print("✓ MobileTopBar.tsx：模型管理入口已按 HS_MODELS_BUNDLED 隐藏")
else:
    print("  · MobileTopBar.tsx：锚未命中（可能已改过）")
