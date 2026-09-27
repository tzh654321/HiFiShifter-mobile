#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1 间距收紧完成 + B2 位置澄清。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## ㊽ D1 间距收紧（真机通过）+ B2 位置澄清

### 间距收紧：**不能用 `BTN_BOX`**

`MobileBottomBar.tsx:67-69` 的注释写得很清楚：

```ts
export const MOBILE_BOTTOM_BAR_HEIGHT = 40;
/** 命中区（≥40px：用户定的"命中区保持 40px"）。 */
const BTN_BOX = 40;
const BTN_VIS = 28;
```

⇒ 40px 是**用户定过的命中区下限**，动它就违反既有约定、手指也更难按。

⇒ 改用**负 margin**：给工具行容器加语义类 `.hs-param-toolrow`，其中
`.hs-param-toolrow .hs-bar-btn { margin-inline: -2px; }` ——
**视觉间距 40→36，命中区仍是 40**（只让元素框重叠 2px，`width/height` 不变）。
省下 8 个间隙 × 4px = 32px，右侧不再贴边。

**真机实测（221deeb）**：9 个按钮全部可见、右侧有余量 ✅

### B2 位置澄清

用户说「该按钮排版还是像原来一样放在锁的右边」⇒ 我之前**改对了地方**：

- V 菜单（∨ 打开的面板）**就是 `.hs-param-rows` 的竖排重排**（CSS 把参数行提成浮层，不重写控件）
  ⇒ 里面那个 `↘MID` 就是 `hs-param-toolbar` 里的「导入 MIDI」按钮（`data-hs-import-midi`）。
- 它和 🔒（`锁定参数线`）同一行，🔒 在 x≈265（宽 36），MIDI 按钮在其右侧。
- 我已把它从**文字 Button**（宽 43，装不下"导入 MIDI"被压成两行 ⇒ 看着像 `↘MID`）
  改成 **`IconButton` + `MidiIcon`**（复用 `FileBrowserPanel` 导出那份）。

⚠️ 该按钮**只在「音高」参数下渲染**（`rootTrack && editParam === "pitch"`），
所以模拟器默认参数下用 CDP 搜不到它 —— 验证时要先切到音高。

⇒ 用户之所以觉得"还没做"，很可能是因为**手机上装的还是旧包**，或**当时不在音高参数下**。
""", encoding="utf-8")
print("✓ memory ㊽ 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
old = next((l for l in t.splitlines() if l.startswith("| **D1** |")), None)
if old:
    t = t.replace(old, old.replace(
        "⚠️ 360 CSS 宽下 9×40px 刚好占满，最右「下移」贴边 |",
        "✅ **间距已按用户口径收紧**（`BTN_BOX=40` 是用户定过的命中区下限，**不能改** ⇒ "
        "改用 `.hs-param-toolrow .hs-bar-btn { margin-inline: -2px }`，视觉 40→36、命中区仍 40）；"
        "真机复测 9 个按钮全部可见、右侧有余量 ✅ |"), 1)
    T.write_text(t, encoding="utf-8")
    print("✓ TASKS.md：D1 补记间距收紧")
else:
    print("· 没找到 D1 行")
