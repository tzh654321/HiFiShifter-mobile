#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skill 追加：wrapper 吞错误 + "只有某个 ABI 失败"的真相。"""
from pathlib import Path

P = Path("C:/Users/tzh/.workbuddy/skills/tauri2-android-bringup/SKILL.md")
t = P.read_text(encoding="utf-8")

ADD = """

---

## 🕳️ wrapper 会吞掉真因 —— 越绕越要先**绕过它**

**2026-09-26 实测**（HiFiShifter arm64 构建失败，排查了三层才见底）。

### 症状与三层误判

`build-apk.sh arm64-v8a` 报：

```
Execution failed for task ':app:rustBuildArm64Debug'.
> Process 'command '...node.exe.bat'' finished with non-zero exit value 1
```

**前两层怀疑都是错的**：

1. ~~symlink 权限~~ —— 目录里的 symlink **实测有效**（能读到几十 MB 真实内容）；
2. ~~磁盘不足~~ —— 当时还有 8 GB。

**绕过 wrapper、直接跑 gradle**，原始 panic 立刻露出来：

```
thread '<unnamed>' panicked at crates\\tauri-cli\\src\\mobile\\mod.rs:403:6:
failed to read CLI options: Context("failed to build WebSocket client",
    ConnectionRefused: "由于目标计算机积极拒绝，无法连接。")
```

⇒ **tauri-cli 在 `mobile` 路径下会建 WebSocket client，连不上就 panic。**

### 🔑 关键洞察：「只有某个 ABI 失败」往往不是 ABI 的问题

x86_64 一直没事，是因为它的 `rustBuildX86_64Debug` **早已 up-to-date**，
tauri-cli 那一步**根本不会被执行**。
arm64 每次都要真编 Rust ⇒ **每次都走那条路 ⇒ 每次都撞**。

⇒ **判据**：**"同一个脚本，只有某个分支失败"时，先想"这条分支是不是第一次走到"**，
而不是去比较两个分支的差异。增量构建会让另一条分支恰好跳过出问题的那一步。

### ✅ 绕过手法（产物已就绪时）

`libbackend_lib.so` 已被前一次构建产出（Rust 编译成功、只是后续步骤崩了）⇒
**把 rust 任务全 `-x` 掉**，只让 gradle 打包：

```bash
cd <gen>/android
export ANDROID_HOME=... ANDROID_SDK_ROOT=... NDK_HOME=...
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
./gradlew.bat --project-dir . assembleUniversalDebug \\
  -x rustBuildArm64Debug -x rustBuildArmDebug \\
  -x rustBuildX86Debug -x rustBuildX86_64Debug
```

⚠️ **任务名要从报错里逐个抄，不要猜** —— 我猜的 `rustBuildArmv7Debug` 不存在；
真实名字是 **`rustBuildArmDebug` / `rustBuildX86Debug`**（在 `:app` 子项目下，
`gradlew tasks --all | grep` **抓不到**）。**报错报哪个就加哪个，加全为止。**

### 打包后必做：核验 .so 是非空 ELF

跳过 rust 任务 ⇒ **没有任何东西保证 `.so` 真的进了包**。
逐一读 ZIP 条目的前 4 字节确认 `\\x7fELF` 且 `file_size > 0`
（等价于 `build-apk.sh §⑧` 的校验）。

### 📌 三条通用教训

1. **wrapper 给出的是"外层描述"，真因在底层命令的原始输出里。**
   越绕的 wrapper，越要**先绕过它直接跑底层**看原始报错。
2. **"只有分支 X 失败" ⇒ 先问"X 是不是第一次跑到那一步"。**
3. **CLI 工具里出现 `WebSocket client` / `ConnectionRefused` 且排除了代理** ⇒
   很可能是该 CLI 的某个子命令**设计上要连一个本地服务**，在纯 build 场景下无解，
   只能绕开该子命令（本例：绕开 `tauri android build`，直接 gradle）。
"""

t = t.rstrip() + ADD
P.write_text(t, encoding="utf-8")
print("✓ skill 追加「wrapper 吞错误 + 分支首次执行」章节")
print("总行数:", len(t.splitlines()))
