#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录真机功能验证进展。"""
from pathlib import Path

M = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\.workbuddy\memory\2026-09-22.md")
M.write_text(M.read_text(encoding="utf-8") + """

## ✅ 真机导入音频成功 + 手机端测试素材就位（07:00-07:30）

### 关键技巧：真机上把测试音频喂给 app（绕开 SAF）

app **读不了 `/sdcard/`**（无 MANAGE_EXTERNAL_STORAGE）⇒ `run-as ... cp` 直接 **Permission denied**。
可行路径是**用 PC 做桥**：

```bash
adb -s 221deeb exec-out "cat '/sdcard/Download/xxx.wav'" > /tmp/hs-test.wav   # 真机 → PC
adb -s 221deeb push /tmp/hs-test.wav /data/local/tmp/test.wav                 # PC → /data/local/tmp（世界可读）
adb -s 221deeb shell "run-as com.arounder.hifishifter sh -c \\
  'mkdir -p files/media && cp /data/local/tmp/test.wav files/media/test.wav'" # 进 app 私有目录
```

然后 CDP 调用（**`import_audio_item` 是 async + spawn_blocking**，不冻前端）：

```js
await window.__TAURI_INTERNALS__.invoke('import_audio_item', {
  audioPath: '/data/user/0/com.arounder.hifishifter/files/media/test.wav',
  trackId: null, startSec: null, mediaAudioStreamIndex: null
});
// ⇒ { ok:true, clipCount:1, trackCount:1, bpm, project_sec, ... }
```

⚠️ **`trackId` 要传 `null`**（不是 `undefined`），否则可选参数序列化可能出问题。

### 素材来源

真机 `/sdcard/Download/` 里本来就有（用户之前放的）：
`SVID_20230729_150306_1 [drums].wav`（2.2MB）、`Collect Colors!!.mp3`、
`StormApproach_NetEast - ... [bass|drums|music|vocals].mp3` 等。

### 参数编辑器的两种模式（排查时踩到的）

- **轨道模式**：`音高 / 共振峰 / 气声 / 张力 / 音量 / 声像 / 算法`（实测这些就是）
- **音符模式**：颤音（**波长 / 振幅**）⇒ **#53 / #7 的改动在这里**

⚠️ **`set_param_editor_mode` 命令不存在** —— 模式切换是**纯前端状态**，不是后端命令。
⇒ 想用 CDP 切模式，得找 DOM 控件自己点；**没有现成的 invoke 入口**。

#53 的改动确认在 `components/layout/pianoRoll/VibratoAdjustOverlay.tsx`
（第 17 行注释：「#53：波长要换算成「秒」，需要采样率。用项目既有常量，别自己写 48000」）。

🟡 **待用户手测**（真机已装最新版，工程里已导入 1 个 clip）：
- #53 波长是否显示为「秒」、振幅是否为「±半音」（需进**音符模式**）
- #7 颤音滑条是否正常（拖一次）
- #10 音频块加入选区
""", encoding="utf-8")
print("✓ memory 已追加")

T = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile\TASKS.md")
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### ✅ 真机导入音频跑通（2026-09-27 07:00-07:30）

**真机上给 app 喂音频的正确姿势**（绕开 SAF 权限）：

```bash
adb -s 221deeb exec-out "cat '/sdcard/Download/xxx.wav'" > /tmp/hs-test.wav
adb -s 221deeb push /tmp/hs-test.wav /data/local/tmp/test.wav
adb -s 221deeb shell "run-as com.arounder.hifishifter sh -c \\
  'mkdir -p files/media && cp /data/local/tmp/test.wav files/media/test.wav'"
```

CDP：`import_audio_item({ audioPath:'/data/user/0/com.arounder.hifishifter/files/media/test.wav',
trackId:null, startSec:null, mediaAudioStreamIndex:null })`
⇒ **`{ok:true, clipCount:1, trackCount:1}`** ✅

⚠️ **`trackId` 传 `null` 而非 `undefined`**。

**⚠️ 参数编辑器有兩種模式**（排查时踩到）：
- **轨道模式**：音高 / 共振峰 / 气声 / 张力 / 音量 / 声像 / 算法
- **音符模式**：颤音（**波长 / 振幅**）← **#53 / #7 在这**

`set_param_editor_mode` **不是后端命令**（模式是纯前端状态）⇒ CDP 切模式得点 DOM。

🔴 ~~待手测~~ ⇒ 真机工程里已导入 1 个 clip，**可直接手测**：
- #53 波长→秒 / 振幅→±半音（**需进音符模式**）
- #7 颤音滑条
- #10 音频块加入选区
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
