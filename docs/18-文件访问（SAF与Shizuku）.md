# 18 · 文件访问：SAF 浏览（修法 A）与 Shizuku 全盘访问

> 状态：**设计已定稿，实现未开始**（2026-09-28）。
> 起因：N2「文件管理器看不到支持的文件」——它是 D8（从文件浏览器长按拖音频到轨道）的前置。
> 用户口径（2026-09-28）：**N2 走修法 A（SAF 浏览）**；**TODO 里同时要有"通过 Shizuku 在非 root 机访问全部文件"的方法**；两者一起做。

---

## 1. 根因（已实测证明，不是猜测）

在模拟器上直接调后端命令（`scripts/_dbg-listdir.mjs`）：

| 调用 | 结果 |
| :--- | :--- |
| `list_directory("/storage/emulated/0/HiFiShifter")` | **只有 1 项**：`123`（目录）|
| 同一目录 `adb shell ls` | `123/`、**`hs-tone.wav`**、**`hs_test_tone.wav`** |
| `list_directory("/storage/emulated/0")` | 正常 **15 项**（Alarms/Android/Audiobooks…）|

⇒ **两个 `.wav` 被静默丢掉**，而且**没有报错**。原因不是我们的过滤逻辑，而是
**Android 10+ 分区存储的 FUSE 层**：应用对 `/storage/emulated/0/...` 无授权时，
`readdir()` **只返回它能访问的条目**（目录通常可见、无权限的文件**直接不出现**），
系统**不报错**。

⇒ 由此推出 UI 侧的连锁反应：`list_directory` 既不报错，
文件浏览器就**进不了错误态**，于是它的「**授权访问目录**」按钮
（`fb_grant_dir_access`，只挂在错误态上）**永远不会出现** —— 用户看到的就是"空白/不完整的列表，没有任何提示"。

---

## 2. 现状：修法 A 的管线**其实已经写好了**（缺的是"授权可见性"）

| 层 | 已有能力 | 位置 |
| :--- | :--- | :--- |
| Kotlin | `listTreeChildren(treeUri, relPath)`（用 `DocumentsContract` 列目录）、`takePersistableUriPermission`、`savedTreeUri()`、按名字找子文档、物化到 cacheDir、`writeToUri` | `android/kotlin/HifishifterFs.kt` |
| Rust | `saf::pick_folder()`（`ACTION_OPEN_DOCUMENT_TREE`）、`saved_tree_uri()`、`tree_real_prefix()`、`platform::saf::list_tree_children` | `src/platform/saf.rs`（补丁 `0003`）|
| Rust | `list_directory()`：**若路径落在已授权 tree 内 ⇒ 自动改走 SAF**；否则走普通 `fs::read_dir` | `src/commands/file_browser.rs:83-154` |
| 前端 | 错误态里的「授权访问目录」按钮 + 授权后**重试原路径** | `FileBrowserPanel.tsx:924`、`fileBrowserSlice.ts:33` |
| 前端 i18n | `fb_grant_dir_access` | `zh-CN.ts:1507` |

**结论**：**唯一缺的是"让用户知道并完成授权"**——既没有常驻入口，也因为没有错误态而拿不到那个按钮。

---

## 3. 修法 A 的收口（建议实现顺序）

### 3.1 后端：把"未授权 ⇒ 列表不可信"变成**可判定的状态**

新增一个命令（Rust，`commands/file_browser.rs`）：

```rust
/// 让前端知道"当前这个目录的列表是否可信"。
/// - on_shared_storage：路径是否落在共享存储（/storage/emulated/0 等）
/// - covered_by_tree：是否被已授权的 SAF tree 覆盖（= 走 SAF 列举，可信）
/// - all_files：是否已具备"所有文件访问"（MANAGE_EXTERNAL_STORAGE 或 Shizuku 自助授权）
/// - needs_auth：on_shared_storage && !covered_by_tree && !all_files ⇒ 列表可能被 FUSE 静默截断
pub(crate) fn storage_access_state(dir_path: String) -> serde_json::Value
```

Android 侧需要两个新桥接方法（Kotlin，`HifishifterFs.kt`）：
`fun isExternalStorageManager(): Boolean`（`Environment.isExternalStorageManager()`）
与 `fun sharedStorageRoots(): Array<String>`（`Context.getExternalFilesDirs` 反推 + `Environment.getExternalStorageDirectory()`）。

> 桌面平台：该命令恒返回 `needs_auth = false`，行为零变化。

### 3.2 前端：把授权做成**常驻入口**，并在需要时给出明确提示

- 文件浏览器工具条始终显示「授权访问目录」按钮（Android 上；桌面隐藏）；
- 打开目录后调用 `storage_access_state`：`needs_auth` 为真 ⇒ 在列表上方显示一条提示条
  （文案建议：「当前目录未授权，列表可能不完整 —— 点这里授权文件夹」）+ 同一个按钮；
- 授权成功后**重试当前路径**（沿用既有逻辑）；`all_files` 为真时不再提示。

### 3.3 默认根目录

现在默认根是 `/storage/emulated/0/HiFiShifter`（应用自建目录）。它是"应用私有语义"的路径，
在共享存储上同样是**未授权就看不到文件**。建议：Android 上默认根改为
`storage_access_state` 判定后的**已授权 tree**（若存在），否则停在根并提示授权。

### 3.4 验收

| 用例 | 期望 |
| :--- | :--- |
| 未授权 + 打开共享存储目录 | 出现「授权访问目录」提示与按钮（**不再静默空列表**）|
| 授权一个含音频的目录后 | 列表出现 `.wav/.mp3` 等（与 `adb shell ls` 一致）|
| 该目录里长按音频 | 出现拖拽态（D8 的前置，与 `docs/15` 规格一致）|
| 桌面平台 | `needs_auth=false`、按钮不显示、行为与今天逐字节一致 |

---

## 4. Shizuku 方案（非 root 机访问"全部文件"）

### 4.1 原理

Shizuku 让**普通应用**借到 **shell(adb) 身份**去调用系统 API（它自身由用户通过
"无线调试 / adb" 启动一次）。借到这个身份后，就能执行一条**系统自带的**授权命令，
把自己变成"所有文件访问"应用：

```
appops set <pkg> MANAGE_EXTERNAL_STORAGE allow
```

之后 `Environment.isExternalStorageManager()` 返回 `true`，
**普通 `java.io`/`std::fs` 就能读全盘** ⇒ 文件浏览器、导入、拖拽**全部不需要 SAF**。

> 这条路的价值：SAF 只能"一处一处授权目录"，而且拿到的是 `content://`（要物化）；
> Shizuku 授权后是**真路径直读**，与桌面端行为一致，连带解决
> "导入/导出/工程另存为"等所有路径驱动逻辑（见补丁 `0003` 里"上游是路径驱动"那段注释）。

### 4.2 落地要点

| 项 | 内容 |
| :--- | :--- |
| 依赖 | `dev.rikka.shizuku:api` + `dev.rikka.shizuku:provider`（AAR），加入 Android 工程 |
| 清单 | 注册 `rikka.shizuku.ShizukuProvider`（provider + `@xml/shizuku_provider_paths`）|
| 权限 | 运行时请求 Shizuku 授权（`Shizuku.requestPermission`），未安装/未启动时给引导 |
| 授权动作 | `Shizuku.newProcess(["sh","-c","appops set <pkg> MANAGE_EXTERNAL_STORAGE allow"])`，读退出码与 stderr |
| 状态查询 | Kotlin 侧 `Environment.isExternalStorageManager()`，经 3.1 的 `storage_access_state.all_files` 暴露给前端 |
| UX | 设置/文件面板里一个「用 Shizuku 开启全盘访问」按钮：未装 Shizuku ⇒ 给安装与"无线调试启动"的说明；已授权 ⇒ 显示"已开启全盘访问" |
| 降级 | Shizuku 不可用 ⇒ 自动回落到修法 A（SAF），两条路互不依赖 |
| 撤销 | 同一条命令 `appops set <pkg> MANAGE_EXTERNAL_STORAGE deny`，或用户在系统设置里关 |

### 4.3 风险与边界（务必写进用户可见文案）

- **需要用户自己装 Shizuku 并用"无线调试"启动一次**（每次重启手机后要重跑一次启动步骤）；
- Shizuku 的 shell 身份**不是 root**，但 `appops` 这条是 shell 可执行的；
- 部分厂商 ROM 可能限制 `appops`（需实测；失败时要给出可读错误，而不是静默失败）；
- **上架政策**：`MANAGE_EXTERNAL_STORAGE` 在 Google Play 属敏感权限，
  若将来要上架，应把"Shizuku 自助授权"作为**可选高级功能**、默认不申请。

### 4.4 验收（本机做不到的部分要写清）

| 用例 | 环境 |
| :--- | :--- |
| Shizuku 未安装 ⇒ 按钮给引导、不崩 | 模拟器可验 |
| Shizuku 已装 + 无线调试启动 ⇒ 点按钮后 `all_files=true`、列表与 `ls` 一致 | **需真机**（模拟器装不了 Shizuku 服务）|
| 撤销后回落 SAF 路径仍可用 | 真机 |

---

## 5. 与 N2 / D8 的关系

```
N2（文件浏览器列不出文件）
 ├── 修法 A：SAF 浏览 —— 管线已在，缺"授权可见性"（§3）
 ├── 修法 S：Shizuku 自助全盘访问（§4）—— 授权后连 SAF 都不需要
 └── D8（长按音频拖到轨道窗）—— 二者任一完成即可验收
```

> 📌 下一轮第一步：先做 §3.1 + §3.2（最小改动、可在模拟器上验收：
> "未授权时必须出现授权入口而不是空列表"），再按 §4 接 Shizuku（需真机验收）。
