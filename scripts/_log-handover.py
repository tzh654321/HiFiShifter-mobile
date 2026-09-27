#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录接手交接 + D4 收口动作。"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")
MEM = ROOT / ".workbuddy" / "memory" / "2026-09-27.md"

MEM.write_text("""# 2026-09-27

## 接手另一对话的交接（19:45）

用户带来另一个对话的收尾汇报，交接写在 `TASKS.md` 第 **973 行**起（`# 🔁 交接`）。
执行单位 = 用户 16:2x 下达的 **23 条新批次**，编号 **A1–A5 / B1–B3 / C1–C6 / D1–D8**。

### 接手时的真实状态

| 状态 | 数量 | 内容 |
| :--- | :-: | :--- |
| ✅ 已完成并设备实测 | **15** | A1/A2/A4 · B1/B2/B3 · C1/C2/C3/C4 · D1/D2/D5/D6 · 规格表 ①–⑧ |
| 🟡 已改未验证 | **3** | **D4**（未构建未装机）· D7（需带气声参数的轨道）· C3 数量断言（属语义变更，**要先问用户**）|
| ⬜ 未开始 | **8** | C5/C6 · A3 · A5 · D3 · D6b · D8（阻塞于 N2）|

**下一步 = D4 收口**。

### ⚠️ 接手先做的两件事（都必要）

**① 补丁漂移（交接方没做）**

交接方改了前端但**没重生成补丁**。跑 `verify-patches.sh` 报 **16 个文件内容漂移**：

```
App.tsx · PianoRollPanel.tsx · TimelinePanel.tsx · usePianoRollInteractions.ts
TrackList.tsx · TimelineKernelView.tsx · timelineKernelHost.ts · touchGesture.ts
MobileBottomBar.tsx · MobileTopBar.tsx · i18n/{zh-CN,zh-TW,en-US,ja-JP,ko-KR}.ts · index.css
```

⇒ `regen-frontend-patch.sh` 后复验：**5 个补丁全 OK、78 个文件逐字节一致**。
⇒ **教训**：接手别人的工作，**第一件必须是 `verify-patches.sh`** ——
不跑就构建/装机，等于把「补丁没跟上工作树」这个债继续滚下去。

**② 构建脚本有两套，本项目两侧都通**

交接里写的是 `scripts\\build-apk.ps1`；我这边一直用 `scripts/build-apk.sh`（23KB）。
两者都在。⚠️ **Bash 工具禁 `powershell` 那个词**（连注释里出现也拦）、且**执行策略禁 `.ps1`**
⇒ 我继续用 `.sh`，别混用（两套脚本的 §⑧/§⑩ 校验逻辑未必逐字一致）。

### D4 代码核对（✅ 真的在）

```
TrackList.tsx:2530+     长按菜单（交接方本轮补的）
MobileTopBar.tsx:383+   菜单栏那条（早已有）
i18n/zh-CN.ts:5-6       menu_track_raise_level / menu_track_lower_level
```

后端**没有** promote/demote 命令 ⇒ 前端用现有重排 API 自实现，合理。

语义（两边注释一致）：
- **升高辈分** = 从父轨移出、插到父轨之后，成为父轨的**兄弟**（层级 −1）
- **降低辈分** = 成为**上一个同级轨道**的子轨（层级 +1）
""", encoding="utf-8")
print("✓ 已写 memory/2026-09-27.md")
