#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 调研：把「关联文件被打开」的事件送进导入流程。

本轮**只调研 + 记录**，不动手改（跨 Kotlin/Rust/前端三层，改完必须完整构建 + 装机验证，
工程量和 SAF v1 相当；凌晨硬做容易出错）。
"""
from pathlib import Path

ROOT = Path(r"C:\Users\tzh\Documents\code\HiFiShifter-mobile")

M = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
M.write_text(M.read_text(encoding="utf-8") + """

---

## #9 调研（03:23-03:40）—— 关联文件送进导入流程

### 现状

- ✅ **Manifest 已注册**（`ACTION_VIEW` + `content|file` × `{json, octet-stream, zip, audio/*, audio/midi}`），
  `dumpsys package` 实测已生效 ⇒ 其他应用「打开方式」能看到本软件；
- ❌ **点了"打开"之后没反应** —— `MainActivity.kt` 里**完全没有处理 `intent.data`**，
  `onNewIntent` 也只转给了 `pluginManager`。

### 三层改法（都有现成模式可抄，改动量中等）

**① Kotlin** —— 两个入口都要接：

```kotlin
// MainActivity.onCreate 结尾（冷启动）
HifishifterFs.acceptOpenIntent(intent)
// MainActivity.onNewIntent（应用已在后台时）
override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); pluginManager.onNewIntent(intent); HifishifterFs.acceptOpenIntent(intent) }
```

在 `HifishifterFs` 里加：

```kotlin
@Volatile private var pendingOpenPath: String? = null   // 只留最近一个
fun acceptOpenIntent(intent: Intent?) {
    val uri = intent?.data ?: return
    val act = activity ?: return
    runCatching { val n = queryDisplayName(act, uri); pendingOpenPath = materialize(act, uri, n) }
        .onFailure { Log.w(TAG, "关联文件物化失败", it) }
}
@JvmStatic fun takePendingOpenPath(): String? = pendingOpenPath.also { pendingOpenPath = null }
```

✅ **`materialize()` 是现成的**（`HifishifterFs.kt:131`，已有 `saf_import/` 缓存 + 时间戳前缀 + 24h 清理），
**直接复用即可** —— 不需要新写物化逻辑。
⚠️ `takePendingOpenPath` 用 `@JvmStatic`（与现有 `request` 同款），Rust 侧用
`CallStaticObjectMethod` 拿 `java.lang.String`。

**② Rust** —— 加一条命令（照抄 `platform/saf.rs` 的 JNI 套路）：

- `with_env(|env| ...)` + **`app_class(env, KOTLIN_CLASS)`**
  ⚠️ **不能 `env.find_class()`** —— native 附加的线程只有系统类加载器视野（saf.rs:445 注释已写明）；
- `env.call_static_method(cls, "takePendingOpenPath", "()Ljava/lang/String;", &[])`；
- 返回 `Ok::<Option<String>, String>`，前端拿不到就 `None`。

**③ 前端** —— 启动后（以及 `visibilitychange` / `resume` 后）调一次这条命令，
拿到路径就走**现有的导入工程流程**（`.hshp`）或音频导入流程。

### ⚠️ 落地注意

- `gen/android` 是**生成物** ⇒ Kotlin 改动必须同时改 **`scripts/setup-gen-android.sh`**，
  否则下次重放就被抹掉（这是本项目的硬规矩）；
- 改 Kotlin ⇒ **必须完整构建**（Kotlin 编进 dex，换 `.so` 覆盖不到）；
- 建议先做 **`.hshp` 工程文件**这一条路径（用户最常见），音频文件另议。
""", encoding="utf-8")
print("✓ memory 已追加")

T = ROOT / "TASKS.md"
t = T.read_text(encoding="utf-8")
t = t.rstrip() + """

### 🔍 #9 调研结论（2026-09-27 03:40）—— 待动手

- ✅ **Manifest 已生效**（`dumpsys package` 实测），其他应用能看到本软件；
- ❌ **`MainActivity` 里完全没处理 `intent.data`** ⇒ 点了「打开」没反应。

**改法（三层，都有现成模式）**：
1. **Kotlin**：`HifishifterFs.acceptOpenIntent(intent)`，在 `onCreate` 结尾 + `onNewIntent` 各调一次；
   **直接复用现成的 `materialize()`**（`HifishifterFs.kt:131`，已有缓存/时间戳/24h 清理），
   存在 `pendingOpenPath`，再用 `@JvmStatic takePendingOpenPath()` 取一次即清。
2. **Rust**：加命令，照抄 `platform/saf.rs` 的 `with_env` + **`app_class()`**
   （⚠️ **不能 `find_class()`**，native 线程只有系统类加载器视野），
   `call_static_method(cls, "takePendingOpenPath", "()Ljava/lang/String;", &[])`。
3. **前端**：启动后调一次，拿到路径走现有导入流程。

⚠️ ⚠️ **必须同时改 `scripts/setup-gen-android.sh`**（`gen/android` 是生成物，手改会被抹掉）；
改 Kotlin **必须完整构建**。建议先只做 `.hshp` 工程文件路径。
"""
T.write_text(t, encoding="utf-8")
print("✓ TASKS.md 已更新")
