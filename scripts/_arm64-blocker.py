#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录：arm64 构建被 tauri-cli 的 WebSocket panic 阻塞，及绕过手法。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## 🔴 arm64 构建的真实阻塞：tauri-cli 自己 panic（不是 symlink、不是磁盘）

### 症状链（三层误判）

`bash /d/Temp/_hs_clean_build.sh`（= `build-apk.sh arm64-v8a`）失败，报：

```
Execution failed for task ':app:rustBuildArm64Debug'.
> Process 'command '...node.exe.bat'' finished with non-zero exit value 1
```

**先怀疑的两层都是错的**：

1. ~~symlink 权限~~ —— `jniLibs/arm64-v8a` 里的 symlink **实测有效**
   （`wc -c` 能读到 69MB / 1.8MB 真实内容）；
2. ~~磁盘~~ —— C 盘当时有 8.4G。

### 真因（直接跑 gradle 才看到）

**绕过 tauri-cli 直接跑 gradle**，原始 panic 就露出来了：

```
> Task :app:rustBuildArm64Debug
thread '<unnamed>' panicked at crates\\tauri-cli\\src\\mobile\\mod.rs:403:6:
failed to read CLI options: Context("failed to build WebSocket client",
    Io(Os { code: 10061, kind: ConnectionRefused,
           message: "由于目标计算机积极拒绝，无法连接。" }))
```

⇒ **tauri-cli 在 `mobile` 路径下会建一个 WebSocket client，连不上就 panic。**
排除了代理环境变量（`unset HTTP_PROXY...` 后仍复现）。

⚠️ **为什么 x86_64 一直没事**：x86 的 Rust **早就编好了**，
`rustBuildX86_64Debug` 是 up-to-date，tauri-cli 那步**不会被执行** ⇒ 不 panic。
**arm64 每次都要真编 Rust ⇒ 每次都走 tauri-cli ⇒ 每次都 panic。**

### ✅ 绕过手法（可复用）

`.so` 由前一次（或部分成功的）构建准备好了，剩下只是 gradle 打包 ⇒
**把 4 个 rust 任务全 `-x` 掉**：

```bash
cd upstream-src/backend/src-tauri/gen/android
export ANDROID_HOME="D:\\Android\\Sdk" ANDROID_SDK_ROOT="D:\\Android\\Sdk"
export NDK_HOME="D:\\Android\\Sdk\\ndk\\27.2.12479018"
./gradlew.bat --project-dir . assembleUniversalDebug \\
  -x rustBuildArm64Debug -x rustBuildArmDebug \\
  -x rustBuildX86Debug -x rustBuildX86_64Debug
```

⇒ `BUILD SUCCESSFUL in 5s`。

⚠️ **任务名要从报错里逐个抄** —— 不是 armv7/i686 而是
**`rustBuildArmDebug` / `rustBuildX86Debug`**（`tasks --all` 的 grep 抓不到，
它们在 `:app` 子项目下）。**报错报哪个就加哪个**，加全为止。

### 产物核验

```
APK 299,874,590 字节（286 MB）
  OK  lib/arm64-v8a/libSoundTouchDLL.so   511,296      \\x7fELF
  OK  lib/arm64-v8a/libbackend_lib.so      69,027,040   \\x7fELF
  OK  lib/arm64-v8a/libc++_shared.so       1,794,776    \\x7fELF
  OK  lib/arm64-v8a/libonnxruntime.so      28,637,280   \\x7fELF
```

⇒ **4 个 .so 全是非空 ELF** ⇒ 可用。（这一步是 `build-apk.sh §⑧` 的等价校验。）

### 真机安装

```bash
adb -s 221deeb push <apk> /data/local/tmp/hs-arm64.apk
adb -s 221deeb shell pm install -r -t /data/local/tmp/hs-arm64.apk
# → Success（48.6 MB/s，286MB 约 6 秒）
```

### 📌 教训

1. **`build-apk.sh` 把 tauri-cli 的输出吞了** —— 它给出的是
   "node.exe.bat exit 1" 这种**外层描述**，真因在 gradle 原始输出里。
   ⇒ **越绕的 wrapper，越要先绕过它直接跑底层命令看原始报错。**
2. **"只有某个 ABI 失败"往往不是 ABI 的问题**，而是**那条路径第一次被走到**
   （增量构建让另一个 ABI 恰好跳过了出问题的那一步）。
3. 任务名要**从报错里抄**，不要猜（我猜的 `rustBuildArmv7Debug` 就不存在）。
""", encoding="utf-8")
print("✓ memory 已追加")

M = ROOT / ".workbuddy" / "memory" / "MEMORY.md"
if M.exists():
    mt = M.read_text(encoding="utf-8")
    if "tauri-cli 会 panic" not in mt:
        anchor = "## 环境（真相与坑，全文 docs/14）"
        if anchor in mt:
            mt = mt.replace(anchor, """## 🔴 arm64 构建的独立坑（2026-09-26）

**`tauri android build` 在 `crates/tauri-cli/src/mobile/mod.rs:403` 会建 WebSocket client
并 panic**（`ConnectionRefused`）。x86_64 之所以没事，是因为它的 `rustBuildX86_64Debug`
早已 up-to-date、**那一步根本不会执行**；arm64 每次真编 Rust ⇒ 每次都撞。

⇒ **绕过**：`.so` 已就绪时，直接 gradle 打包并跳过 4 个 rust 任务：

```bash
cd upstream-src/backend/src-tauri/gen/android
./gradlew.bat --project-dir . assembleUniversalDebug \\
  -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug
```

⚠️ 任务名从报错里抄（不是 armv7/i686，而是 **`rustBuildArmDebug` / `rustBuildX86Debug`**）。
脚本 `scripts/build-arm64-bypass.sh`（本轮新增）已封装。

""" + anchor, 1)
            M.write_text(mt, encoding="utf-8")
            print("✓ MEMORY.md 已更新")
    else:
        print("  · MEMORY.md 已有")
