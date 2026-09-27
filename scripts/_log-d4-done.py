#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 D4 通过 + D7 静态验证。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

## ✅ D4 收口：设备实测通过（20:10-20:20）

```
bash scripts/build-apk.sh x86_64          # 3m26s，§⑩ ABI 自检：x86_64 包 ↔ x86_64 模拟器 ✅
adb push D:/hifishifter-out/hifishifter-x86_64-debug.apk /data/local/tmp/hs-d4.apk
adb shell pm install -r -t -d /data/local/tmp/hs-d4.apk   ⇒ Success
node scripts/_probe-track-menu-sync.mjs emulator-5554
```

结果 **2/2 通过**：

```
菜单栏-轨道：   ["添加轨道","克隆轨道","删除","重命名","升高辈分","降低辈分"]
长按轨道菜单：  ["添加轨道","克隆轨道","删除","重命名","升高辈分","降低辈分"]
长按缺=[]   长按多出=[]                        ✅ D4-a / D4-b
```

⇒ **D4 从「🟡 已改未验证」转入「✅ 设备实测通过」**。

## 🟡 D7：代码已确认正确，但**缺数据**（无法在模拟器上验完）

探针 `_probe-breath-icon.mjs` 在模拟器上跑（含 `--scan-tracks`）都报
**「未找到气声行」** —— 因为模拟器里**没有轨道**（只有个空的 "音高"），
更没有**带气声参数**的轨道。

**静态验证：豁免代码是对的**（两处都在）：

```js
// MobileBottomBar.tsx:1420 —— 豁免压暗
opacity: row.hasBreathSwitch ? 1 : row.secondary ? 1 : 0.4,

// PianoRollPanel.tsx:2093 —— 什么时候算「气声行」
hasBreathSwitch: p.id === "breath_gain" && breathDesc !== undefined,
```

⇒ 条件 = 该参数列表里**有 `breath_gain` 且有它的描述**。
⇒ **要验完 D7 必须有一条能产生 `breath_gain` 的轨道**（真机上用户已有的音频可能就满足；
模拟器得先喂音频 + 选对算法）。

⚠️ **注意 D7 的图标本体**（`PianoRollPanel.tsx:398-430` 的 `BreathAirIcon`）：
它**自己**用 `off` 控制透明度（`off=true` ⇒ 三条线 `opacity 0.4` + 多画一条斜杠）。
所以「关闭态」**本来就该是暗的**，D7 要修的是**外层那层"非当前参数压暗"**别叠加到它身上 ——
这点注释里写清了，别再误改图标本体。

## 📌 接手别人的工作，第一件事是 `verify-patches.sh`

交接方改了 16 个前端文件但**没重生成补丁**（见本文件开头）。补完才构建。
**顺序不能反**：补丁没跟上工作树就构建/装机 = 把债继续滚下去。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.replace(
    "| **D4** | 长按轨道菜单缺「升高辈分/降低辈分」，**代码已补**（`TrackList.tsx`），tsc 通过，**未构建未装机** | 构建 x86_64 → 装机 → `node scripts\\_probe-track-menu-sync.mjs`（期望 2/2）|",
    "| ~~**D4**~~ | ✅ **已完成**（2026-09-27 20:20）：构建 x86_64 → 装机 → `_probe-track-menu-sync.mjs` **2/2 通过**（两处菜单条目完全一致，`升高辈分/降低辈分` 都在）| — |",
    1,
)
t = t.rstrip() + """

### ✅ 接手方动作记录（2026-09-27 20:00–20:50）

1. **补补丁漂移**：交接方改了 16 个前端文件未 regen ⇒ `verify-patches.sh` 报 16 处漂移
   ⇒ `regen-frontend-patch.sh` 后复验 **78 文件逐字节一致**。
2. **D4 收口**：构建 x86_64（3m26s）→ 装机 → `_probe-track-menu-sync.mjs`
   ⇒ **2/2 通过**（长按轨道菜单与菜单栏-轨道条目完全一致）。
3. **D7 静态验证**：豁免代码确认正确
   （`MobileBottomBar.tsx:1420` 的 `hasBreathSwitch ? 1 : … 0.4`；
   成立条件 `PianoRollPanel.tsx:2093` = `p.id==="breath_gain" && breathDesc!==undefined`）
   ⇒ **缺一条带 `breath_gain` 的轨道才能跑完探针**。
4. ⚠️ **真机仍是 19:12 的 arm64 包**（不含 D1/D2/D4/D5/D6）⇒ 要真机复核须先 `build-apk.sh arm64-v8a`。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
