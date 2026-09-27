#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㉞ 节（本轮两个大项的判断）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㉞ 本轮收尾：两个大项的判断（**没有硬做**）

用户说「下一步」。我先把剩下的两项摸清，**结论是都不能再塞进一轮**：

**#7 颤音滑动条** —— 是**完整功能**（约 300~400 行），而且动的是参数编辑器的**手绘主流程**
（`usePianoRollInteractions.ts` 3000+ 行；`vibratoStateRef` 有**五个清空出口**，挂钩子要全考虑）。
它还包含一条**跨 Rust 的新编辑通道**（滑动条 → 回写 amplitude / frequency）。
⇒ 方案已写进 `TASKS.md`（4 步：浮层 → 记线 → 回写 → 关闭），**建议单独开一轮、每步单独验证**。

**#17 删底栏** —— `MobileBottomBar.tsx` **1421 行**，上面挂着 `∧` 更多开关 / 撤销 / 重做 /
停止 / 播放 / 录制，手机形态还有**四个页签**（文件 / 记事本）。删掉**必须先定这些按钮搬去哪**，
否则就是把功能删没了。⇒ 已把三个必须先确认的问题写进 `TASKS.md`。

⚠️ **本轮选择不硬做的理由**：用户的口径是「端到端完成、不要半成品」。
这两项都属于「**跨层 + 动核心**」，硬做出来大概率是半成品，反而要花更多轮收拾。
**摸清边界、给出可执行方案、请用户拍板**，比闷头写 400 行更负责。

### 🕳️ 又踩了一次反引号（第 7 次）

用 `python -c "..."` 写这段 memory 时，文本里的反引号（`usePianoRollInteractions.ts` 等）
再次被 bash 当命令替换执行，直接报 `unterminated triple-quoted string literal`。
**这条规则已经写进 skill 了，我还是踩了** —— 说明「知道」和「形成条件反射」是两件事。
⇒ **从现在起：只要要写的内容里有反引号、`$`、`!`，一律先 Write 成 `.py` 文件再跑，不再用 `-c`。**
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉞ 节已追加")
