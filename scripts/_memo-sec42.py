#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 ㊷ 节：#7 成功收尾 + 第 6 轮需求。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㊷ #7 成功收尾 + 第 6 轮需求下达（2026-09-25 凌晨）

用户实测「成功了」—— 颤音滑条终于生效。

### 🔴 真根因（第二版修复才对，第一版是错的）

`commitStroke` 内部靠 `applyToParamViewDense → setParamView` 刷新前端，
而那里开头是 `if (!pv) return;`（`useLiveParamEditing.ts` L118）——
**没有 live-edit base 时它静默跳过 UI 更新**，但后面的后端 IPC 照常执行
⇒ 表现就是 **「N 恒为 213、报成功、曲线不动」**。

| 尝试 | 结果 |
| :--- | :--- |
| 只加 `ensureLiveEditBase(pv)` | ❌ **没用**（用户实测 N 恒 213）|
| `ensureLiveEditBase` + **`applyDenseToLiveEdit`** + **`invalidate()`**，最后 `commitStroke` | ✅ **成功** |

⇒ 教训：**同一条数据有两条 UI 更新路径时，去看"能工作的那条"用的是哪个接口**，
别在"不工作的那条"上加参数。绘制路径能实时刷新，就是因为它走 live 预览层。

### 收尾 7 项（用户确认后的追加要求，全部完成）

| 项 | 做法 |
| :--- | :--- |
| 隐藏调试信息 | 去掉浮层上的 `diag` 行 |
| 振幅要小数 | 读数 3 位小数 |
| 滑条下密上疏 | 幂映射 `ampMax·t³`（t=0.5 只到 1/8，契合"多用 2 以内、偶尔几十"）|
| 拖动实时渲染 | 🕳️ 根因：节流 timer 放在 **effect 内部**，而依赖含 `currentParamRange` ⇒ effect 重跑 ⇒  cleanup 清掉 timer ⇒ **节流 flush 永远等不到**，只有松手那次生效。改 `useRef` 后解决 |
| 播放不关浮层 | "框外"判定收紧：`button` / `input` / `role=slider` **一律不算空白** |
| 标签主题色 | `--accent-9` |
| 工具名 | 确认仍是「直线/颤音」|

⚠️「播放会关闭浮层」这个现象很典型：**"点框外关闭"和界面上大量按钮天然冲突** ——
只按「区域」判定不够，必须把**所有可交互控件**排除掉才稳。

### 第 6 轮需求（已整理进 TASKS.md，A/B/C/D/E 五组）

- **B 组**：气声音量左侧图标与右侧一致、V 菜单 `↘MID` 换真图标+比例对齐、
  **软件图标糊**、文件浏览器长按音频拖到轨道窗
- **C 组**：**#17 删底栏** —— 底栏三项（轨道/参数/文件/笔记）全部改成**勾选项进「视图」菜单**（模仿 flm）
- **D 组**（参数界面 6 项）：上工具栏右对齐加 复制/剪切/粘贴 + 上移/下移；
  笔菜单加「还原」工具；🐞 选区后点拍数栏改进度条；选择工具加三角菜单+「拖动」工具（手套）；
  🐞 钢琴栏缩放卡边界
- **E 组**：flm 交互规格表（单击/双击/划动/长按/双指…，截图已存档）

**安装包大小答疑**（用户问）：其他系统 ~170MB 是因为只内置 `nsf_hifigan`(56MB)；
我们多打了 `hnsep`(93MB) + `fcpe`(43MB) ⇒ 298MB。
要回到 170MB 就得改回"首次使用时下载/导入"。

### 状态

APK（arm64，286 MB）**已于 02:45 构建完成**并归档到 `D:/hifishifter-out/`。
真机 `221deeb` 在装机时掉线（凌晨 2:47），下次连上直接：
`adb -s 221deeb push … /data/local/tmp/hs.apk && adb -s 221deeb shell pm install -r /data/local/tmp/hs.apk`
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㊷ 节已追加")
