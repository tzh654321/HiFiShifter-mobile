# HiFiShifter Mobile（安卓移植）

把 [ARounder-183/HiFiShifter](https://github.com/ARounder-183/HiFiShifter)（Tauri 2 + React 的图形化人声编辑 / 人力 Vocaloid 调参工具）移植到 Android。

**当前阶段（2026-09-18）：上游本体已在 Android 上跑起来。**

| 里程碑 | 状态 |
| :--- | :--- |
| 方案与决策（`docs/00`–`docs/08`） | ✅ 完成 |
| **M0 探针**（真机 + 模拟器双端） | ✅ 全绿，四条卡点全部有了实测结论（见 [10 文档](docs/10-M0探针实测结果.md)） |
| **M1 打通**（改上游代码让它编得过 Android） | ✅ `cargo check --target aarch64-linux-android` **0 错误**（含 WORLD / SoundTouch / Signalsmith 的完整 native 交叉编译）；产出 **4 个可重放补丁**（全部通过 `git apply --reverse --check`） |
| **首次 APK 构建** | ✅ arm64（256.5 MB）与 x86_64（269.0 MB）双向打通，APK 审计零孤儿条目 |
| **M2 首次冒烟** | ✅ **应用跑起来了**：`MainActivity` 存活、PSS 150 MB、无 Rust panic、`tauri.localhost` 前端加载、**WebGL2 渲染内核在跑**、中文渲染正常（截图见 `docs/screenshots/`） |
| M2 正式内容（模型路径收口 / SAF / 裁命令 / 体积或手势与布局） | ⏳ 下一步 |

> 冒烟截图同时**实测印证了 [04 文档](docs/04-小屏排版适配.md) 对小屏排版的全部预判**：
> 菜单栏仍是桌面尺寸、参数面板页签文字互相重叠、时间线区被压成很窄一条。
> 也就是说「桌面 UI 直接搬上手机」确实不可用 —— 三套布局是必需的，不是过度设计。

---

## 一、先看结论（7 条）

1. **路线确定**：走 **Tauri 2 官方 Android 通道**，保留全部 Rust 后端（7.1 万行）与 React 前端（10.4 万行），只做「平台裁剪 + 交互层适配 + 多形态排版」三件事。不需要重写音频引擎，不需要把算法搬去 Kotlin。
2. **上限很高、但有四个硬卡点**——**2026-09-18 已实测（见 [10 文档](docs/10-M0探针实测结果.md)）**：
   - ✅ `ort 加载 ONNX Runtime`：已通。`onnxruntime-android:1.28.0` + `load-dynamic` + **裸 soname** 即可。
   - ✅ `cpal/Oboe 出声`：已通（回调 276828 样本／3 秒）。**但真正的阻塞和原预判完全不同**——
     不是 `libc++_shared.so`（Tauri 已自动处理），而是 **`ndk_context` 从未被 Tauri 栈初始化，
     而 cpal 强依赖它、未初始化时直接 panic**。已用 `JNI_OnLoad` + `ActivityThread.currentApplication()` 修复。
   - ✅ `184 MB 模型怎么进包与怎么被读到`：路线确认（`resource_dir()` 实测返回 `asset://localhost/`，
     Tauri resources 落在 `assets/<原名>` 无前缀），拷贝吞吐 47–175 MB/s → **外推 184 MB 只需 1–4 秒**。
   - ⏳ `content://` 文件访问（SAF）：**探针尚未覆盖**，仍是未验证项。
3. **没有捷径**：上游 18 个分支、11 个 fork，**没有任何移动端代码**。但核实后发现**也不需要从任何分支摘代码**——见第 6 条。
4. **主要工作量在 UI，不在算法**：触控适配（45 处右键 + 61 处鼠标键判断 + 124 处滚轮 + 115 处键盘依赖）与多形态排版（**全前端 0 处 `@media`**、98 处硬编码 px 字号、49 处文字截断 + 91 处失效的 hover tooltip）合计是本项目最大的成本。
5. **好消息之一**：上游已全面使用 **Pointer Events**（`pointerdown/move/up` 共 258 处，`touchstart` 0 处）。
6. **好消息之二（已核实，推翻了初版两处结论）**：
   - `develop` **已自带完整 WebGL2 渲染内核**（`renderKernel/gl/*` + `waveform/surfaceRenderer` + 字形图集管线）与**离线性能基准**（`npm run bench`），且已有针对「10 轨 / 400 clip / 全览缩放」卡顿的性能设计文档。→ **渲染性能不需要我们做**。
   - **双指纵横缩放/平移所需的内核 API 已经全部存在**：`scrollKernel` 的 `setViewport`（水平「缩放+位置」原子提交）与 `setRowHeightAndScrollTop`（竖直原子提交）就是为此写的，且 `setZoom` 的锚点**明确允许落在视口之外**——"缩放中心为两指中点"天然成立。→ **这部分是接线工作，不是从零实现**。
7. **一个容易踩的坑**：判断上游分支价值必须用**最新活跃分支（`develop`）**做基准。用陈旧的 `main` 会得出完全误导的数字（详见 [00](docs/00-上游调研与分支盘点.md) §2）。

---

## 二、已确定的决策（2026-09-18）

| 项 | 决定 |
| :--- | :--- |
| **屏幕形态（Q1）** | **手机必须好用**；**平板不复用手机布局**，参照 FL Studio Mobile 走「可停靠多面板 + 可拖分隔条」。→ 三套并存：`phone` / `tablet` / `desktop` |
| **模型分发（Q2）** | 内置 `nsf_hifigan`(54 MB)；`hnsep`(88 MB) / `fcpe`(41 MB) 为可选包，**应用内下载 + 本地文件导入双通道，且离线可用**（下载后永久离线，不做联网校验，不做联网阻断） |
| **后台播放（Q3）** | 第一版不做（退后台即暂停，不加前台服务与通知） |
| **ABI（Q4）** | **仅 `arm64-v8a`**；AVD 也必须用 arm64 镜像 |
| **minSdk（Q5）** | **26（Android 8.0）** |
| **GitHub fork（Q6）** | 建真 fork；**凭据相关操作（创建 fork / `git push` / 改可见性）由你执行**，我到该步会提醒 |
| **上游分支摘取（Q7）** | **不摘任何分支**。`develop` 已经比那些分支都新 |

完整 ADR 见 [06 文档](docs/06-风险登记与决策记录.md)，落地细节见 [07 文档](docs/07-决策落地与FLM式自适应布局.md)。

---

## 三、文档索引

| 文档 | 内容 | 什么时候看 |
| :--- | :--- | :--- |
| [00 · 上游调研与分支盘点](docs/00-上游调研与分支盘点.md) | 仓库概况、18 个分支逐条价值评估（已按 `develop` 为基准更正）、11 个 fork 盘点、代码平台耦合量化 | 想了解"为什么选这个基线" |
| [01 · 移植方案总览](docs/01-移植方案总览.md) | 三条技术路线对比与选型、**功能裁剪表**、里程碑 M0–M5、仓库结构、四个技术卡点的方案对比、工作量估算 | **先看这份** |
| [02 · 后端改造清单](docs/02-后端改造清单.md) | 依赖逐条判定、逐文件裁剪清单、`build.rs` 改造、模型加载重做、7 项 M0 探针 | 开始改 Rust 代码时 |
| [03 · 触控交互适配](docs/03-触控交互适配.md) | 桌面→触控完整映射表、4 个交互决策、手势层结构、长按/模式化设计 | 做交互时 |
| [04 · 小屏排版适配](docs/04-小屏排版适配.md) | 三类问题（显示不全/被遮挡/按钮太小）的量化定位与专项治理、**三套布局骨架**、逐界面清单 | 做 UI 时 |
| [05 · 测试环境与验收](docs/05-测试环境与验收.md) | **四层测试环境**、CDP 调试、排版审计与手势回归脚本、性能基准、设备矩阵、验收流程 | **动手前先搭环境** |
| [06 · 风险登记与决策记录](docs/06-风险登记与决策记录.md) | 13 条风险表、**ADR-001 ~ ADR-013**、Q1–Q7 闭环记录、本地环境坑 | 决策与排期时 |
| [07 · 决策落地与 FLM 式自适应布局](docs/07-决策落地与FLM式自适应布局.md) | Q1–Q7 落地细则、**FLM 事实核对表 + 三套布局规范**、模型分包与离线保证、**GitHub 操作步骤与登录时刻清单**、两处结论更正 | 想确认"为什么这么做" |
| [08 · 双指手势与视口内核对接规范](docs/08-双指手势与视口内核对接规范.md) | **内核 API 1:1 映射**、统一的「中点锚定」公式、轴向保护（死区/轴锁定/三指）、手势状态机、提交时序、验证方案 | **做双指手势时必读** |
| [09 · 环境盘点与 M0 探针](docs/09-环境盘点与M0探针.md) | 本机工具链逐项实测（Rust / NDK / emulator / JDK17 / 镜像源）、M0 探针工程说明、环境坑 | 复现环境时 |
| [10 · M0 探针实测结果](docs/10-M0探针实测结果.md) | **逐探针实测输出**、头号发现 `ndk_context`（含解法与证据链）、`load-dynamic` 静态符号陷阱、APK 体积虚胖、对 01–06 的修正 | **想知道实测结论时** |
| [11 · SAF 文件访问设计](docs/11-SAF文件访问设计.md) | **`content://` 在边界物化成真实路径**的核心决策、Kotlin↔Rust 双向 JNI 桥、三个 SAF 动作、另存为的状态问题、**不靠点界面就能验证的方法** | **做文件导入时** |

### M2 进展（2026-09-18）

| 项 | 状态 |
| :--- | :--- |
| ① 模型/资源路径收口 | ✅ **已完成并实测**：`src/platform/resources.rs` 把 `assets/models/**` 物化到 `app_data_dir`（184 MB **逐字节**与 APK 内声明一致），上游三个声码器模块**零改动**；随后 PSS 150 → 361 MB，证明模型真被加载 |
| ①′ 新发现：Android 日志后端 | ✅ **已完成**：上游 `logging::init_logging()` 只在 `main.rs` 调用，移动端**一个 logger 都没有**；已补 `src/platform/logging.rs`（logcat + 落盘双通道） |
| ② SAF 文件访问 | 📐 **设计定稿**（[docs/11](docs/11-SAF文件访问设计.md)），待实现 |
| ③ 被裁命令返回 `unsupported` | ✅ **验证完毕：上游已做对**（剪贴板 / loopback / vslib 都有降级分支）。剩余缺口是前端漏了 1 个错误码 → 转布局阶段隐藏入口 |
| ④ ADR-012 把模型移出 APK | ⏸ **配方已确认但暂缓**：`bundle.resources` 是**并集**，唯一减法要改 base conf；删了会立刻丢两个功能，**必须先有 SAF 导入通道** |


---

## 四、⚠️ 需要你登录 GitHub 的三个时刻（Q6）

你已明确：提交与公开由你操作。我会在这些点提醒你。

| # | 时刻 | 操作 |
| :--- | :--- | :--- |
| 1 | 创建 fork | 网页端打开上游仓库 → 点 **Fork**（建议仓库名 `HiFiShifter-mobile`） |
| 2 | 首次 `git push` | 终端会要求凭据。建议先配 SSH key 或 PAT，之后就不用每次输 |
| 3 | 修改仓库可见性 / 发 Release | 网页端。注意 fork 默认继承上游的公开属性 |

命令序列见 [07 文档 §5](docs/07-决策落地与FLM式自适应布局.md)。

---

## 五、目录现状

```
HiFiShifter-mobile/
├── README.md                ← 本文件
├── prompt.md                ← 原始需求
├── docs/                    ← 方案文档集（11 份，00–10）
│   └── screenshots/         ← 实测截图（首次冒烟）
├── android/                 ← 适配层：patches/（4 个补丁）+ shim/（fdk-aac 的 log/log.h）
├── probes/m0-probe/         ← M0 探针工程（与 upstream-src 完全隔离）
├── third_party/onnxruntime/ ← libonnxruntime.so（arm64-v8a / x86_64，带 SOURCE.txt）
├── dist/                    ← 构建产物（已 gitignore）
├── scripts/
│   ├── android-env.sh/.ps1    环境变量与自检（含 JDK 17 的 major 版本校验选择器）
│   ├── make-avd.ps1           建 AVD（含分辨率/密度覆盖）
│   ├── build-android.sh       ★ Rust 侧构建/检查（cmake + fdk-aac shim + ANDROID_*）
│   ├── setup-gen-android.sh   ★ tauri android init 之后必跑（minSdk/ABI/jniLibs/gradlew shim/BuildTask）
│   ├── build-apk.sh           ★ 完整 APK（含前端构建与 jniLibs 同步）
│   ├── sync-native-libs.sh    third_party → gen/android jniLibs
│   ├── run-app.sh             ★ 装**上游本体** + 启动 + 收日志 + 分时截图
│   ├── run-probe.sh           装**隔离的探针工程** + 跑全量探针
│   ├── audit-apk.sh           APK 体积审计（查孤儿条目虚胖 / ABI 混入）
│   ├── measure-inset.py       ★ 量「系统栏有没有压住内容」（截图像素量测）
│   ├── layout-audit.mjs       ★ 排版审计：越界 / 被祖先裁掉 / 被遮挡 / 触摸目标 <44px
│   ├── touch-drive.mjs        ★ 模拟点击/划动/**双指**（走 CDP）+ 前后状态摘要
│   ├── lib/cdp.mjs            零依赖 CDP 客户端（Node 22 自带 fetch + WebSocket）
│   └── apply-patches.sh / export-patches.sh
├── .cargo/config.toml       ← crates.io 镜像 + NDK 工具链 env + linker
└── upstream-src/            ← 上游完整克隆（当前已检出 develop，280daae4）
    ├── remote "upstream" → https://github.com/ARounder-183/HiFiShifter.git
    ├── backend/             Rust 71,453 行，含 184 MB ONNX 模型
    └── frontend/            React 104,354 行
```

**构建流程（从干净克隆开始）**：

```bash
source scripts/android-env.sh                      # 自检
bash scripts/apply-patches.sh                      # 打 5 个补丁
cd upstream-src/backend/src-tauri && npx tauri android init   # 生成 gen/android
cd - && bash scripts/setup-gen-android.sh arm64-v8a            # 必须：改生成物（含 inset 修复）
bash scripts/build-apk.sh arm64-v8a                             # 出 APK
bash scripts/run-app.sh real                                    # 装机 + 启动
```

**没有 bash 的环境（例如 DSH）用 PowerShell 版**（逐条复刻上面的链路，两条路径等价）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1 x86_64    # 模拟器
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-apk.ps1 arm64-v8a # 真机
```

> ⚠️ 两个环境坑（都实测踩过）：
> ① `.ps1` 若含中文必须存成 **UTF-8 with BOM** —— PS 5.1 默认按 ANSI 读脚本，中文会把引号吃掉，报一堆 `Unexpected token`；
> ② **陈旧的 Gradle daemon 会缓存启动时的环境**（曾导致 `rustBuild` 去找 WorkBuddy 的 node shim 而失败）——
> 症状是 `A problem occurred starting process 'command '…node.exe.bat''`，杀掉所有 `java.exe` 再构建即可。


**触屏验收（不需要真机，模拟器即可）**：

```bash
# 1. 打开 CDP 通道（debug 包自带 WebView 调试；wry 在 debug 下会开）
PID=$(adb -s emulator-5554 shell pidof com.arounder.hifishifter | tr -d '\r')
adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_$PID

# 2. 排版审计（「看得到」）与触摸驱动（「点得到」）
node scripts/layout-audit.mjs --json report.json
node scripts/touch-drive.mjs find 帮助            # 按文字定位控件
node scripts/touch-drive.mjs tap  235 16          # 真点下去 + 前后状态摘要
node scripts/touch-drive.mjs pinch 180 500 40 140 # 双指缩放
```

> ⚠️ 坐标是 **CSS px、相对 WebView 视口**，不是截图的设备像素。详见 `docs/13`。


### 关于「fork」

本机没有 `gh` CLI 也没有 GitHub 凭据，因此**尚未在 GitHub 上创建真 fork**（已决定要建，但按你的要求留给凭据持有人操作）。当前是用 `upstream-src/` 的完整克隆做分析。

**步骤 1 — 你在网页端创建 fork**（需登录）
打开上游仓库 → 右上角 **Fork** → 建议仓库名 `HiFiShifter-mobile`。

**步骤 2 — 我配置 remote**
```bash
cd upstream-src
git remote add origin git@github.com:<你的账号>/HiFiShifter-mobile.git   # 建议用 SSH，免重复登录
git push -u origin develop:develop                                        # ← 这一步会要求凭据
```

**步骤 3 — 追加移植层并提交**
```bash
git add android docs scripts README.md
git commit -m "chore: android port plan and adaptation layer skeleton"
```

> 同时按 [01 文档 §4.3](docs/01-移植方案总览.md) 建立 `android/patches/`，用「可重放补丁」而不是直接改上游——上游 `develop` 一个多星期就有 500 文件变化，直接改会陷入永久冲突。

---

## 六、⚠️ 本仓库的操作坑（已踩过两次）

| 坑 | 现象 | 处理 |
| :--- | :--- | :--- |
| **不要用 `git checkout <分支>` / `git switch <分支>`** | 命令会被中断，工作树残留 250–330 个已删除文件 + `.git/index.lock` | 恢复：`rm -f .git/index.lock && git checkout -- .`（此命令可用，切分支不可用）；看别的分支内容用 `git show <branch>:<path>` |
| **全树 git 操作要给足超时** | 184 MB 模型恢复需 1 分钟以上，默认 120 s 超时会被中断成"半删"状态 | 任何全树操作显式给 ≥ 10 分钟超时 |
| **`git remote rename` 后跟踪引用可能丢失** | `refs/remotes/*` 为空 | 用已知 SHA 重建：`git branch <name> <sha>` |
| **git 直连 GitHub 曾代理故障** | `Failed to connect to github.com:443 over proxy 127.0.0.1`，但 `curl` 正常 | 网络异常时先用 `curl -sI https://api.github.com` 区分是 git 配置还是网络 |

---

## 七、建议的下一步

1. **搭 P0 测试环境**（真机 CDP 调试 + 一个 360 CSS px 宽的 **arm64** AVD），见 [05 文档 §10](docs/05-测试环境与验收.md)。
2. **跑 M0 探针**：cpal 出声 / ort 加载模型 / assets 拷贝计时 / SoundTouch 与 WORLD 交叉编译；同时实测 [08 文档 §6](docs/08-双指手势与视口内核对接规范.md) 的 WebView 行为问号。这决定路线是否需要调整。
3. **在 GitHub 上建 fork**（需要你登录）→ 建立 `android/patches/` 骨架。
4. **第一批后端补丁**（[02 文档](docs/02-后端改造清单.md)）→ 让 `cargo check --target aarch64-linux-android --no-default-features --features onnx` 通过。
5. **再动 UI 层**：先做双指手势（[08 文档](docs/08-双指手势与视口内核对接规范.md)）→ 再做 Phone / Tablet 两套外壳（[04 文档](docs/04-小屏排版适配.md) §3）→ 最后做三类专项治理（[04 文档](docs/04-小屏排版适配.md) §6–§8）。

---

## License

上游基于 **MIT License**。移植版需保留原始版权声明，并在 README / 关于页注明「基于 ARounder-183/HiFiShifter」。注意上游动态链接了 **LGPL** 的 SoundTouch，需保留其许可证声明。
