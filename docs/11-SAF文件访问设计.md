# 11 · SAF 文件访问设计（M2 第 2 项）

> 状态：**v1 已实现并在模拟器上端到端验证通过**（2026-09-20）。
> 实现顺序排在「模型路径收口」（已完成，见 `docs/02` §6）之后，
> 因为 ADR-012「`hnsep`/`fcpe` 改为按需导入」**依赖本项** —— 本地导入模型走的就是同一套 SAF。
>
> ## 实现落点（与本设计的差异都在下面）
>
> | 层 | 文件 |
> | :--- | :--- |
> | Kotlin（真源） | `android/kotlin/HifishifterFs.kt` → 由 `setup-gen-android.sh` **§8** 拷进生成物 |
> | Kotlin（注入） | `gen/android/.../MainActivity.kt`：`attach(this)` + `onActivityResult` 转发（脚本 §7 生成） |
> | Rust 协议 | `src/platform/saf.rs`（新增，含 `#[no_mangle]` 回调 + 超时 + mpsc 会合） |
> | Rust 衔接 | `src/platform/dialog.rs`（Android 实现换成真弹窗，**返回形状不变**） |
> | 上游改动 | `src/commands.rs`：7 个对话框命令由同步改 **async + spawn_blocking**（见 §3.6） |
>
> ## v1 覆盖范围
>
> | 方法 | 调用点 | 状态 |
> | :--- | ---: | :--- |
> | `pick_file` | 7 | ✅ 真弹窗 |
> | `pick_files` | 1 | ✅ 单选降级 |
> | `pick_folder` | 1 | ⏳ 返回 `None` + `warn`（tree URI 要懒物化，见 §7.2）|
> | `save_file` | 4 | ⏳ 返回 `None` + `warn`（见 §3.5）|
>
> ## 实测验收（模拟器 x86_64，API 35）
>
> ```
> ① 选择器弹出    mCurrentFocus = com.google.android.documentsui/...picker.PickActivity   ✓
> ② 取消回传      invoke → {"ok":true,"canceled":true}                                     ✓
> ③ 选中并物化    invoke → {"ok":true,"canceled":false,
>                            "path":"/data/user/0/<pkg>/cache/saf_import/1789877537187_hs-saf-test.wav"}
>                 磁盘上 88244 bytes（与源一致），首 16 字节 RIFF…WAVE 与源**逐字节相同**    ✓
> ④ 线程          `[dialog]` 日志的 tid=7871 ≠ 主线程 7720 ⇒ 确实跑在阻塞线程池上          ✓
> ```
>
> **驱动方式**（不需要人点 UI）：从 CDP 直接调命令 ——
> `window.__TAURI_INTERNALS__.invoke('open_audio_dialog')`，
> 选择器用 `uiautomator dump` + `input tap` 导航（抽屉 → 下载 → 文件）。


---

## 1. 问题

Android 上应用**不能浏览文件系统路径**。上游的能力面是这样的：

| 位置 | 现状 |
| :--- | :--- |
| `rfd::FileDialog` 调用点 | **13 处**，分布在 `commands/` 下 6 个文件（打开音频、打开工程、保存工程、选择目录、导入 REAPER/VocalShifter 等） |
| 文件 IO | 全部是 `std::fs::File::open(path)` 这类**路径驱动**的写法，散落几十处 |
| 我们当前的降级 | `src/platform/dialog.rs` 的 no-op：所有 `pick_*` 返回 `None`（= 用户取消），并打 `warn` |

所以 Android 上**目前无法导入任何文件**。这是让它"能用"的第一道门槛。

## 2. 核心决策：**把 `content://` 在边界处物化成真实路径**

两条路可选：

| 方案 | 做法 | 判定 |
| :--- | :--- | :--- |
| A. 把 `content://` 一路透传给 Rust | 全链路改用 `ContentResolver` 流式读写，Rust 侧把每个 `File::open` 换成抽象 `Read` | ❌ 要改几十处 IO，且**破坏上游路径驱动的架构**（工程文件里存的是路径，SAF URI 无法持久化到工程里） |
| **B. 边界物化（选它）** | Kotlin 侧拿到 URI 后**立刻把流拷到应用私有目录**，把**真实路径**交给 Rust | ✅ 上游 IO 一行不改；`content://` 只在 Kotlin 一侧出现 |

**B 的代价与接受理由**：

- 导入要拷一份文件。典型音频（3–5 分钟 WAV）约 30–50 MB，实测拷贝吞吐 47–461 MB/s（`docs/10` 探针 4）
  ⇒ 一次导入 **0.1–1 秒**，可接受。
- 位置选 **`cacheDir`**（不是 `filesDir`）：导入是**一次性**动作，上游会把音频解码进工程内存/自有缓存，
  原始文件不必长期留存；放 cache 让系统在低存储时可回收，避免用户导入几十个文件后
  应用体积无限膨胀。**代价**：系统可能清掉 cache，但那时工程数据已在别处，不影响正确性。
- 反过来，**模型文件不放 cache**（`docs/02` §6 的 `platform::resources.rs` 用的是 `app_data_dir`）——
  模型是长期资产且被 mmap/反复读取，被回收会导致功能消失。

> 一句话规则：**导入的原料 → cache；长期资产（模型）→ app_data_dir。**

## 3. 架构

### 3.1 三层

```
前端 (React)  →  上游命令（不变）  →  platform::dialog::FileDialog（唯一改动点）
                                            ↓ Android
                                      platform/saf.rs（Rust 侧协议）
                                            ↕ JNI（双向）
                                      gen/android 里的 FsBridge.kt（Kotlin 侧）
                                            ↓
                                      SAF Intent → 用户选文件 → 拷贝到 cacheDir
```

**改动面只有 `platform/dialog.rs` + 新增 `platform/saf.rs` + Kotlin 两个文件。**
上游 13 处调用点与全部路径驱动 IO **一行不改**。

### 3.2 Kotlin 侧（源码放在 `android/kotlin/`，由 `setup-gen-android.sh` 拷进生成物）

为什么不能直接写在 `gen/android/` 里：那是 `tauri android init` 的**生成物**，
会被整体重写。所以沿用与 `gradlew` shim、`BuildTask.kt` 相同的做法 ——
仓库里存一份真源，脚本重放。

需要两个文件：

**`HifishifterFs.kt`** —— 三个动作：

```kotlin
object HifishifterFs {
    const val KIND_OPEN = 0          // ACTION_OPEN_DOCUMENT      → 打开一个文件
    const val KIND_SAVE = 1          // ACTION_CREATE_DOCUMENT    → 另存为一个文件
    const val KIND_TREE = 2          // ACTION_OPEN_DOCUMENT_TREE → 选一个目录

    // requestId 由 Rust 生成，原样回传，用来唤醒等待中的调用
    fun request(activity: Activity, requestId: Long, kind: Int, mime: String, suggestedName: String?)
    fun onActivityResult(requestId: Long, resultCode: Int, data: Intent?)   // 由 MainActivity 转发
    external fun nativeOnResult(requestId: Long, kind: Int, localPath: String?, displayName: String?, error: String?)
}
```

**`MainActivity.kt`** —— 只需两处（脚本用精确文本替换）：

```kotlin
class MainActivity : TauriActivity() {
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        HifishifterFs.onActivityResult(requestCode.toLong(), resultCode, data)
    }
}
```

> 用 `requestCode` 当 `requestId`（`startActivityForResult` 的 requestCode 是 `Int`，
> 我们把它当作 `requestId.toInt()`），避免再维护一张映射表。
> 若将来要改用 `ActivityResultLauncher`（AndroidX 推荐），`MainActivity` 需实现
> `ActivityResultCaller` —— 但 `TauriActivity` 继承自 `AppCompatActivity`，已经满足。

**物化逻辑**（在 `onActivityResult` 里同步做完再回传）：

```kotlin
val uri = data?.data ?: return fail("saf_cancelled")
val name = queryDisplayName(uri) ?: "import_${System.currentTimeMillis()}"
val safe = name.replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fa5]"), "_")
val dst = File(activity.cacheDir, "saf_import/${System.currentTimeMillis()}_$safe")
dst.parentFile?.mkdirs()
activity.contentResolver.openInputStream(uri)?.use { input ->
    dst.outputStream().use { input.copyTo(it, 256 * 1024) }
} ?: return fail("saf_open_stream_failed")
nativeOnResult(requestId, kind, dst.absolutePath, name, null)
```

要点：
- **文件名净化**：`content://` 的 display name 可能含 `/`、`:`、emoji；必须过滤，否则路径穿越/建文件失败。
  保留中文字符（用户素材名常是中文）。
- **加时间戳前缀**：不同目录的同名文件不会互相覆盖。
- 分块 256 KB，与 `docs/02` 的模型拷贝一致。

### 3.3 Rust 侧

`platform/saf.rs`：

```rust
/// 一次 SAF 请求。阻塞当前线程直到 Kotlin 回传或超时。
/// 必须在**非 UI 线程**调用 —— 上游命令是 async（tokio），天然满足。
pub fn request(kind: Kind, mime: &str, suggested: Option<&str>, timeout: Duration)
    -> Result<Option<PathBuf>, String>;

/// 由 Kotlin 的 JNI 调用唤起。名字必须与 Kotlin 的包名/类名严格对应：
///   com.arounder.hifishifter.HifishifterFs.nativeOnResult
#[no_mangle]
pub extern "system" fn Java_com_arounder_hifishifter_HifishifterFs_nativeOnResult(
    env: jni::JNIEnv, _class: jni::objects::JClass,
    request_id: jni::sys::jlong, kind: jni::sys::jint,
    local_path: jni::objects::JString, display_name: jni::objects::JString,
    error: jni::objects::JString,
);
```

- 等待用 `std::sync::mpsc`：把 `Sender` 存进一个 `Mutex<HashMap<u64, Sender<Result<Option<PathBuf>, String>>>>`。
- **超时必须要有**（建议 300 秒）：用户可能把选择器留在后台、或系统杀了 Activity，
  没有超时会让命令永久挂住、前端卡在 loading。
- 用户点返回 / 取消 → Kotlin 传 `error = "saf_cancelled"` → Rust 返回 `Ok(None)`
  （与现有 `FileDialog` 的 `None` 语义**完全一致**，调用点无感）。

### 3.4 与 `FileDialog` 的衔接（关键：语义要对齐）

`platform/dialog.rs` 的 Android 实现改成真正弹窗，**保持返回值形状不变**：

| 方法 | 现（no-op） | 改成 | 取消时 |
| :--- | :--- | :--- | :--- |
| `pick_file()` | `None` | 弹 `KIND_OPEN` | `None` |
| `pick_files()` | `None` | 循环 `KIND_OPEN`（多选需 `EXTRA_ALLOW_MULTIPLE`，见下） | `None` |
| `pick_folder()` | `None` | 弹 `KIND_TREE` | `None` |
| `save_file()` | `None` | 先返回 `cacheDir/saf_export/<name>` 的真实路径，**上传在写完时补做**（见 3.5） | `None` |

即：**取消 = `None`，能力缺失 = `Err`。** 这条语义区分是 `docs/06` §4.x 里
`platform/dialog.rs` 头部注释承诺过的 M2 收尾项。

### 3.5 「另存为」是唯一有状态的方向

打开/导入是「先拿文件再处理」，另存为是「先处理再写文件」——
Rust 拿到 SAF URI 时**还不知道内容**。做法：

1. `save_file()` 让 Kotlin 弹 `ACTION_CREATE_DOCUMENT`，但**先不写**，
   只把 `content://` 对应的**目标路径**记下来：
   由于我们无法把 `content://` 存成 PathBuf，这里改为
   **在 `cacheDir/saf_export/` 下生成一个临时目标**，把它的真实路径返回给上游；
2. 上游照常往那个路径写（它以为是在写用户选的文件）；
3. 上游写完 → 命令返回前调用 `platform::saf::commit_export(temp_path)`
   → Kotlin 把 `cacheDir/saf_export/xxx` 拷进之前记录的 URI。

第 3 步需要一个"写完了"的时点。上游的导出命令是同步返回的，所以可以在
**`commands/dialogs.rs` 的导出命令末尾**加一行 `commit_export`。
这一处是**本设计唯一需要动上游业务代码的地方**（1 行），已记入 `docs/02`。

> 备选：不实现"另存为到任意位置"，改为导出到 `cacheDir` 后调
> `ACTION_SEND`（分享/保存到下载）。零上游改动，但用户体验差一点。
> **建议第一版走备选**，把 `ACTION_CREATE_DOCUMENT` 留到后续。

### 3.6 🔴 实现时发现的硬约束：对话框命令**必须**离开主线程

本设计 §3.3 写了「必须在**非 UI 线程**调用 —— 上游命令是 async（tokio），天然满足」。
**这个前提是错的**：上游那 7 个对话框命令（`commands.rs`）当时是**同步** `#[tauri::command]`，
而同步命令在 Tauri 里就跑在**主线程**上。Android 上这会死锁，而且症状极具迷惑性：

| 现象 | 真相 |
| :--- | :--- |
| 系统选择器**正常弹出**（`mCurrentFocus` 变成 DocumentsUI）| Intent 是在**阻塞等待之前**发出的，所以看起来一切正常 |
| 但 WebView 的 CDP `Runtime.evaluate` **超时**，前端整页卡死 | Android WebView 的 **JS 线程就是 UI 主线程**，主线程被 Rust 占住 ⇒ JS 停摆 |
| 选完文件毫无反应，最后报 `SAF 选择器 300 秒内没有回传` | `onActivityResult` **必须在主线程**处理，而主线程正阻塞着等结果 ⇒ 结果永远送不回来 |

**修法**：把这 7 个命令改成 `async fn` + `tauri::async_runtime::spawn_blocking`。
这不是新增模式 —— `commands.rs` 里 waveform 那组早就这么做了，文件里还写着
「同步命令会在主线程上执行并阻塞整个 UI（窗口事件 + 其余 IPC），因此这里一律改为
async + spawn_blocking」。照抄即可，改动集中在 `commands.rs` 一个文件。

> 判据很简单：**任何可能阻塞几十秒以上的 IPC 命令都不能是同步的**。
> 对话框天然属于这一类（SAF 超时 300 秒、桌面文件对话框也会等用户）。

## 4. 需要重放的生成物（`setup-gen-android.sh` §7 + §8）

| 文件 | 动作 | 脚本位置 |
| :--- | :--- | :--- |
| `gen/android/app/src/main/java/<pkg>/HifishifterFs.kt` | 从 `android/kotlin/` 拷入（`cmp -s` 相同则跳过） | **§8** |
| `gen/android/app/src/main/java/<pkg>/MainActivity.kt` | 见下 | **§7** |

MainActivity 的实际做法与设计不同：**不是"精确文本替换"，而是整份重写**（§7 本来
就在为 inset 补丁整份生成它，带 `HS-SAFE-AREA-PATCH` 标记做幂等）。所以 SAF 的两处注入
只是往那份生成的正文里加：`onCreate` 里 `HifishifterFs.attach(this)` + 一个
`onActivityResult` 转发。幂等判据相应改成同时检查 `HS-SAFE-AREA-PATCH` 与 `HS-SAF-PATCH`。

§8 还顺手做一次**静态对账**：`Java_<包名里的 . 换成 _>_HifishifterFs_nativeOnResult`
必须在 `platform/saf.rs` 里找得到 —— 否则运行期 `UnsatisfiedLinkError`，而编译期完全
看不出来（§6 把这条列为风险）。

与 `gradlew` shim、`BuildTask.kt` 一样：**幂等**，且脚本要打印一行确认。

## 5. 验证方法（不靠人肉点界面）

SAF 的验证点不是"能不能弹窗"（那是用户才能看到的），而是
**"拿到路径后，上游的导入链路能不能跑通"**。所以分两步：

1. **桥接自测**：加一个临时 tauri 命令 `__saf_smoke`，前端加一个 hidden 按钮触发它
   → 弹选择器 → 选文件 → Rust 打印拿到的大小与首 16 字节。
   用 `run-app.sh` + `adb exec-out run-as ... cat` 或 logcat 读结果。
2. **端到端**：用 `adb push` 把测试音频推到设备，再用 CDP
   （`chrome://inspect` → 前端 console 调 `invoke('import_audio', {...})`）
   直接驱动导入命令，观察 `cache/hifishifter/` 是否出现波形缓存 ——
   这就说明解码链路完整跑通了，**不需要人点任何 UI**。

> 这也解释了为什么 SAF 要排在手势/布局之前：**它是唯一能用脚本闭环验证的功能性改动**，
> 而布局改动只能靠截图比对。

## 6. 风险

| 风险 | 说明 | 对策 |
| :--- | :--- | :--- |
| Kotlin 代码在生成物里 | `tauri android init` 会重写 | 走 `setup-gen-android.sh` 重放（同 gradlew shim） |
| JNI 名字必须逐字符匹配包名 | 包名是 `com.arounder.hifishifter`，改了要同步改函数名 | 名字里用下划线替 `.`；脚本生成时用变量拼 |
| Activity 被系统回收 | 选择器打开期间进程可能被杀 | 超时 + 把 `requestId` 与结果都当"可丢失"处理；命令返回 `Ok(None)` |
| `pick_files` 多选 | `ACTION_OPEN_DOCUMENT` 需 `EXTRA_ALLOW_MULTIPLE` + `clipData` | 第一版只实现单选，多选按"调 N 次"降级 |
| 大文件拷贝占 cache | 用户反复导入大文件 | 启动时清理 `cacheDir/saf_import/` 里 24 小时前的文件 |
| `content://` 无法持久化到工程 | 工程文件里存的是路径 | 这正是选方案 B 的原因：存的是我们 cache 里的真实路径；**但 cache 会被回收** ⇒ 工程重开后可能找不到素材，需要"素材重新定位"提示（上游已有缺失素材的提示机制，待确认） |

## 7. 仍未定的小问题（实现时再定，不阻塞）

1. 素材长期留存 vs cache 回收：是否需要把导入的音频也挪到 `filesDir/imports/`（更稳但占空间）？
   倾向：**工程另存时把素材拷进工程目录**（上游本就该这么做），导入的原始副本留在 cache 即可。
2. `ACTION_OPEN_DOCUMENT_TREE` 选目录后的批量导入：是立刻全拷（可能几十 GB），
   还是懒拷贝（上游读到哪个拷哪个）？倾向**懒拷贝**：在 Rust 侧把 tree URI 记下来，
   遇到 `content://` 路径时按需物化。复杂度更高，留到有真实需求再做。
