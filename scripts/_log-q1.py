#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：本轮 13+4 条问题的处理情况。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## 📋 真机试用反馈：13 条 + 追加 4 条（2026-09-26 傍晚）

### 已完成（4 条）

| 条目 | 做法 |
| :--- | :--- |
| **v 菜单 `↘MID` 换真图标** | 🔑 **找到误解根源**：`MidiIcon`（`FileBrowserPanel.tsx:213`）画的是**两个带符干的音符**，斜向排列下**视觉上就是「↘M」** —— 用户看到的「↘MID」不是文字被压成两行，而是**这个图标的形状**。⇒ 新增 `MidiKeysIcon`（**钢琴键**：白键外框 + 3 分隔线 + 2 黑键），`variant="ghost"` 无底色、14×14 与旁边同尺寸。**实测 SVG 结构 = rect/path/rect/rect ✅** |
| **播放时点拍数栏 = 跳转 + 暂停** | 在**单击路径**（`onUp` 的 `undecided` 分支）加：播放中先 `stopAudioPlayback()` 再 `seekAt`。⚠️ **不能放 `seekAt` 里** —— 双击也走它，会把刚起的播又停掉 |
| **轨道头左划真机无效** | 🔑 **根因**：轨道列是**原生竖向滚动容器**，真实触摸里浏览器接管滚动后发 **`pointercancel`**，`pointermove` 在判定前就被取消；而 **CDP 合成事件不会 cancel** ⇒ "模拟器过、真机不过"。⇒ 改用**原生 touch 事件** + `passive:false`，命中即 `preventDefault` |
| **双指拖动 vs 双指长按要区分** | 我上一轮实现是"两指落下就起 500ms 定时器"⇒ **手指一动定时器照跑**，双指缩放 0.5s 后悄悄点亮 Alt ⇒ slip 混进缩放。⇒ 加 `twoMoved` 标记 + `onTwoMove`：**任一指位移 > 8px 立即取消长按候选** |

### 待做（9 条 + 新 4 条）

**原有 9 条**：
#1 双击轨道时"轨道界面"无效（参数界面正常）· 分屏**分隔线不可拖** ·
**同步时间轴时拍数栏隐藏无效** · 划动空白处应平移 · 轨道菜单**没删快捷键提示、缺子母轨项** ·
未选中目标上**落指直接移动**（应先选择）· **单击音频块显示触控点**（#6 失效的直接原因）·
"轨道"菜单**位置够却靠右** · 5 按钮不进 v 菜单（已做，待确认）

**新增 4 条**：
① **[TODO] Shizuku 全文件访问**（文件管理器看不到支持的文件）—— 用户明确要求**先记 TODO**
② 参数界面**左上角加 X 关闭按钮**
③ **所有界面的关闭键有效化**
④ **钢琴条缩放触边缘依旧卡住**（要求：**不要**做"触点贴合图形"，就是让缩放始终跟手）

### 🔑 本轮最大收获：`build-apk-bypass.sh` 一条命令闭环

```
[1/3] build-apk.sh <abi>    → 前端已编 + Rust 已好；tauri 收尾崩（预期）
[2/3] gradlew -x rust*      → 只打包
[3/3] 核验 APK 内 .so 是非空 ELF
```

🕳️ **中途走过一条弯路**：以为"跳过 tauri ⇒ 省掉 Rust 编译也没关系"，
**错的** —— Tauri 2 把 `frontend/dist` **压缩嵌入 `libbackend_lib.so`**，
跳过编译 ⇒ **前端改动根本不进包**，而构建还显示 up-to-date（极难发现）。
⇒ 也试过用裸 `cargo build` 替代 tauri 那步，**失败**（缺 tauri 设的 C++ 环境，
`fdk-aac-sys` 的 `lpp_tran.cpp` 编译不过）。⇒ **结论：必须让 tauri 编 Rust，只在打包阶段绕。**

⚠️ **验证手法**：前后对比 `libbackend_lib.so` 的大小是否变化
（76,304,608 → 76,304,672 → 76,304,736），**变了才说明前端真进了包**。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
if "真机试用反馈" not in t:
    t = t.rstrip() + """

---

## 📋 真机试用反馈（2026-09-26 傍晚）—— 13 + 4 条

### ✅ 已完成（4）

| 条目 | 说明 |
| :--- | :--- |
| v 菜单 `↘MID` 换真图标 | 🔑 **`MidiIcon` 本身就是「↘M」形状**（两个带符干音符斜排）⇒ 新增 `MidiKeysIcon`（钢琴键），`ghost` 无底色、14×14 同尺寸。实测 SVG = rect/path/rect/rect ✅ |
| 播放时点拍数栏 = 跳转 + 暂停 | 单击路径加"播放中先 `stopAudioPlayback()` 再 seek"。⚠️ 不能放 `seekAt`（双击也走它） |
| 轨道头左划真机无效 | 🔑 **原生滚动容器会发 `pointercancel`** 打断 `pointermove`；CDP 合成事件不会 ⇒ "模拟器过真机不过"。改用原生 touch + `passive:false` |
| 双指拖动 vs 双指长按要区分 | 加 `twoMoved` + `onTwoMove`：**任一指动 > 8px 即取消长按候选**，避免缩放 0.5s 后误点亮 slip |

### ⏳ 待做（9 + 4）

**原有 9**：双击轨道时"轨道界面"无效 · 分屏分隔线不可拖 · 同步时间轴时拍数栏隐藏无效 ·
划动空白处应平移 · 轨道菜单没删快捷键提示/缺子母轨项 · 未选中目标落指直接移动（应先选择）·
**单击音频块显示触控点**（#6 失效的直接原因）· "轨道"菜单位置够却靠右 · 5 按钮不进 v 菜单（待确认）

**新增 4**：① **[TODO] Shizuku 全文件访问**（用户要求先记）② 参数界面左上角加 X 关闭按钮
③ 所有界面关闭键有效化 ④ 钢琴条缩放触边缘卡住（**不要**做触点贴合，只要始终跟手）

### 🔧 新增工具：`scripts/build-apk-bypass.sh`

一条命令拿到可用 APK（绕开 tauri-cli 的 WebSocket panic）：

```
[1/3] build-apk.sh <abi>  → 前端编好 + Rust 好；tauri 崩（预期）
[2/3] gradlew -x rust*    → 只打包
[3/3] 核验 .so 非空 ELF
```

⚠️ **必须让 tauri 编 Rust**（前端被嵌进 `libbackend_lib.so`，跳过则前端改动不进包，
而构建还显示 up-to-date —— 极难发现）。裸 `cargo build` 替代会失败（缺 C++ 环境）。
🔍 **验证前端是否进包**：看 `libbackend_lib.so` 大小有没有变。
"""
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md 已更新")
