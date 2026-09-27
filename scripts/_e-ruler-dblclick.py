#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E 组第一条：**拍数栏双击 = 移动进度条并开始播放**。

规格（flm 交互表）：

| 区域 | 单击 | **双击** |
| :--- | :--- | :--- |
| 拍数栏 | 移动进度条 | **移动进度条并开始播放** |

现有行为：拍数栏单击已 seek（D3 修完的路径），双击时浏览器会先派发两次
`pointerdown` + 一次 `dblclick` ⇒ 单击的 seek 会先执行一次，**这是期望的**
（"移动进度条"是双击的前置动作），随后再起播即可。

播放命令用底栏那颗按钮同款：`isPlaying ? stopAudioPlayback() : playOriginal()`
（`MobileBottomBar.tsx:1063`）。这里只要"开始播放"，所以仅在未播放时起播 ——
双击已播放的拍数栏不该把它停掉。

⚠️ 两处都要加：**时间线**（`TimelinePanel` 的拍数栏）与**参数编辑器**
（`PianoRollPanel`，即用户常在的那个）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
n = 0

# ── ① 参数编辑器：拍数栏挂 onDoubleClick ────────────────────────────────────
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

old = """                        onMouseDown={(e) => {
                            interactions.onRulerMouseDown(e);
                        }}"""
assert t.count(old) == 1, "参数编辑器拍数栏锚不唯一"
t = t.replace(old, """                        onMouseDown={(e) => {
                            interactions.onRulerMouseDown(e);
                        }}
                        onDoubleClick={() => {
                            /* E 组：拍数栏双击「移动进度条并开始播放」。
                               单击的 seek 已由上面那条路径完成（双击本身会先触发一次
                               pointerdown），这里只负责起播 —— 且**仅在未播放时**，
                               免得双击把正在播放的曲子停掉。 */
                            const st = store.getState().session;
                            if (!st.isPlaying) void dispatch(playOriginal());
                        }}""", 1)
n += 1
print("✓ PianoRollPanel：拍数栏加 onDoubleClick")

# import playOriginal（若缺）
import re
m = re.search(r"^import \{\n((?:.*\n)*?)\} from \"\.\./\.\./features/session/sessionSlice\";", t, re.M)
if m and "playOriginal" not in m.group(1):
    t = t[:m.start()] + f'import {{{m.group(1).rstrip()}\n    playOriginal,\n}} from "../../features/session/sessionSlice";' + t[m.end():]
    n += 1
    print("  ✓ import 补 playOriginal")
else:
    print("  · playOriginal import 检查:", "已有" if m and "playOriginal" in m.group(1) else "⚠️ 结构不同")

PP.write_text(t, encoding="utf-8")

# ── ② 时间线：拍数栏挂 onDoubleClick（若有对应元素）────────────────────────
TP = FE / "components" / "layout" / "TimelinePanel.tsx"
t2 = TP.read_text(encoding="utf-8")
# 时间线的拍数栏是原生元素 + bindRulerTouchSeek；找它的 JSX 宿主
print("\n时间线拍数栏的 JSX 锚点探测：")
for pat in ('className="hs-ruler"', "data-hs-ruler", "rulerRef"):
    hits = [i + 1 for i, l in enumerate(t2.splitlines()) if pat in l]
    print(f"  {pat}: {hits[:4]}")
print("\n⚠️ 时间线的拍数栏是原生 DOM + `bindRulerTouchSeek`（命令式事件绑定），")
print("   它的双击要在那个 bind 里加；本轮先做**参数编辑器**（用户主要在那个界面）。")
