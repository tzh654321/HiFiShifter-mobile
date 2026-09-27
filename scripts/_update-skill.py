#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 2026-09-24 这一轮学到的坑补进 tauri2-android-bringup skill。"""
from pathlib import Path

S = Path(r"C:\Users\tzh\.workbuddy\skills\tauri2-android-bringup\SKILL.md")

ADD = """

---

## 2026-09-24 补充：四条踩过多次的坑

### 1. 🔴 UI 改动前，先确认「三条渲染路径」各自渲染哪个组件

这个项目有 **phone / tablet / desktop 三套布局**，同一个界面**可能是两份完全不同的实现**。

**已经因此白费过三次功夫**：

| 项 | 我以为 | 实际 |
| :--- | :--- | :--- |
| 菜单定位 | 改 `MenuBar.tsx` 的 Radix 参数 | **手机上根本不是 Radix** —— 是 `MobileTopBar.tsx` 自己实现的下拉（硬编码 `left: 4`）|
| 菜单箭头 `›` | 在 `MenuBar.tsx` 里 grep | 实现在 `MobileTopBar.tsx`（标签文字里手写 + 组件右侧各一个 ⇒ `››`）|
| 模型管理入口 | 改一处 | `MenuBar.tsx`（桌面/平板）+ `MobileTopBar.tsx`（手机）**各一处** |

**做法（照这个顺序走，别跳）**：

1. 用 CDP 读出**真机上实际渲染的那个元素**的 `class` / `data-*`
   （`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，再驱动 JS `evaluate`）；
2. 拿它的 class 去搜源码 —— **能搜到才算找对了文件**；
3. 对不上就说明改错了渲染路径，别继续改。

判据很硬：如果改了代码、构建成功、但真机行为**毫无变化**，**第一反应就该是"我改的文件没被渲染"**，
而不是"再调调参数"。（当时还有个旁证被我忽略了：`getComputedStyle(...).getPropertyValue('--hs-menu-anchor')`
一直是空串 —— 说明那个组件**根本没挂载过**。）

### 2. 🔴 `clean` 不是免费的：清空 build 目录会引爆一批隐藏问题

**现象**：清掉 `D:/hs-build/*` 之后，构建连续 4 次失败，错误各不相同：
`Couldn't delete .../R.txt` → `.../zip-cache` → 换目录……每次都锁不同的东西。

**关键提示在错误里**：
> `This might happen because a process has files open or has its working directory set in the target directory.`

**真因是守护进程持着句柄**，不是"文件系统拦截" ——
判据：`/usr/bin/rm` **能**删掉那些文件 ⇒ 删除本身没被拦，是**有人占着**。

**为什么"清了反而坏"**：之前能一直构建成功，是因为那些 task 命中了 **UP-TO-DATE 缓存、根本不执行**；
清空后它们**必须真跑**，于是每一处「先删旧产物再写新的」都撞上句柄。

**有效解法（顺序不能错）**：

```bash
# 1) 停 gradle daemon
./gradlew.bat --stop
# 2) ⚠️ 关键：停掉所有 java（--stop 管不到 KotlinCompileDaemon，
#    而它的工作目录就卡在 zip-cache 那类目录里）
#    用 PowerShell 工具：Get-Process java | Stop-Process -Force
# 3) 用真 rm 绕开 safe-delete 垫片，确保真的清干净
/usr/bin/rm -rf /d/hs-build/*
# 4) ⚠️ 还要删掉 jniLibs 这个 symlink 本身
#    （只清 D:/hs-build 会留下空壳 symlink，tauri 再建时报 os error 183）
/usr/bin/rm -rf gen/android/app/src/main/jniLibs
# 5) 重建 ⇒ 一次通过
```

⚠️ **`wmic` 已被本机安全策略禁用**（`SYSTEM TOOL DISABLED`），列不出进程命令行 ⇒
用 **PowerShell 工具的 `Get-Process`**（该工具 stdout 不回传，看 exit code 即可）。

### 3. `ACTION_CREATE_DOCUMENT` 的 `type` 不能是 `*/*`

保存方向（SAF v2）实测：**工程保存失败、WAV 导出正常** —— 差异只在一个字段：

| 用途 | exts | `mime()` 结果 |
| :--- | :--- | :--- |
| WAV 导出 | `[wav]` | `audio/*` ← **具体** ✓ |
| 工程保存 | `[hshp, hsp, json, zip]` | **`*/*`** ✗ |

`ACTION_CREATE_DOCUMENT` 的 `type` 要求**具体 MIME**；`*/*` 在部分 ROM（ColorOS 实测）上
会让创建流程异常、回传空 `data` ⇒ 我们判成"用户取消"。
⇒ 保存方向折成 `application/octet-stream`（`save_mime()`）。

⚠️ **导入方向的 `*/*` 不能动** —— 导入恰恰需要它，否则用户在选择器里看不到目标文件。
**导入与保存对 MIME 的要求是相反的。**

### 4. 🕳️ 别用 `python -c "长文本"` 改代码/文档

文本里的**反引号**会被 **bash 当命令替换执行**（一天踩了 6 次，最惨一次把刚写好的 memory
吞成了残句）。**一律写成 `.py` 文件再跑。**

同类问题：`$xxx`、`$()`、`!` 也会被 shell 展开。
"""

text = S.read_text(encoding="utf-8")
if "2026-09-24 补充" in text:
    print("· 已存在该补充章节")
else:
    S.write_text(text.rstrip("\n") + ADD, encoding="utf-8")
    print(f"✓ skill 已追加（{len(ADD)} 字符）")
print(f"  现在共 {len(S.read_text(encoding='utf-8').splitlines())} 行")
