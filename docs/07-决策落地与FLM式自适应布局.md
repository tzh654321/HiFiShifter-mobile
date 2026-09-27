# 07 · 决策落地（Q1–Q7）与 FLM 式自适应布局

> 本文件落实 2026-09-18 的决策，并给出三套并存的布局规范。
> 同时修正 `docs/00` 与 `docs/01` 中两处**已被后续核实推翻**的结论（见 §4）。

---

## 1. Q1–Q7 决策记录

| # | 问题 | 你的决定 | 落地措施 |
| :--- | :--- | :--- | :--- |
| **Q1** | 平板优先 vs 手机必须好用 | **手机必须好用；平板不得是手机界面直接放大，参照 FL Studio Mobile** | §2 起：**三套并存的布局**（Phone / Tablet / Desktop），平板走「可停靠多面板 + 可拖分隔条」而非缩放 |
| **Q2** | 是否接受基础 APK 不含 hnsep/fcpe | 接受首次下载导入，但**必须离线可用** | §3：模型包「下载 + 本地文件导入」双通道；下载后可完全离线；不做"必须联网才能用"的设计 |
| **Q3** | 第一版是否做后台播放 | 可以接受（退后台即暂停） | 不加前台服务与通知；`01` 文档的 ADR 更新 |
| **Q4** | 是否出 x86_64 包 | 只出「大多数真机都能跑」的版本 | **只出 `arm64-v8a`**。理由与代价见 §3.2 |
| **Q5** | 最低 Android 版本 | 按建议 | **minSdk 26（Android 8.0）**。`targetSdk` 取当时最新稳定版 |
| **Q6** | 是否建真 fork | 需要，但**提交与设为公开由你操作** | §5：给出完整命令序列，并标出**需要你登录 GitHub 的三个时刻** |
| **Q7** | 是否摘 `feature/waveform-webgl2-renderer` | 你不好判断 → 我核实后给出结论 | **不需要摘，该分支已过时。develop 里已经有更完整的 WebGL2 渲染内核。** 详见 §4 |

---

## 2. Q1 落地：FLM 式自适应布局（三套并存，不是一套缩放）

### 2.1 先对齐 FL Studio Mobile 的做法

核实到的 FLM 事实（来自官方手册与第三方拆解文档）：

| 事实 | 出处 | 对我们的意义 |
| :--- | :--- | :--- |
| 移动端是 **single-screen、tab-based navigation**（Playlist / Channel Rack / Mixer…之间用页签切换） | 第三方拆解对照表 | 对应我们的 **Phone 布局** |
| 桌面/插件版是 **fully customizable, multi-window layout with dockable panels** | 同上 | 对应我们的 **Tablet 布局**（可停靠 + 可拖分隔条）——**这正是"平板不是手机放大"的含义** |
| 手势是 **pinch to zoom / drag to scroll / long-press to open context menus** | 官方使用指南原文 | **与 `docs/03` 的设计完全一致**，等于外部验证了手势方案 |
| 顶部工具栏是**常驻**的 transport（play / tempo / metronome / CPU-latency meter） | 同上 | 对应我们的 `PlaybackBar` 常驻设计；额外提示：**CPU/延迟表值得加上**（移动端用户需要它判断该降配什么） |
| clip 边缘有 handles 用于 resize/loop；**双击 clip 打开对应编辑器** | 同上 | 对应我们的角部把手设计；"双击打开编辑器"可作为长按菜单之外的第二入口 |

**推论（我的设计判断，非 FLM 原文档表述）**：FLM 的关键不在于"用了几块面板"，而在于**同一套面板组件在不同的屏宽下呈现为不同的组合方式**——手机看到 1 块，平板看到 3 块，而**组件本身不缩放**。这正好契合我们已有的组件结构（`TimelinePanel` / `PianoRollPanel` / `FileBrowserPanel` / `NotebookPanel` 本来就是独立面板）。

### 2.2 三套布局规范

```
┌─ Phone      宽度 < 600 CSS px（竖屏或横屏都算）
│   1 块面板 + 底部页签 + 常驻播放条
│   组件尺寸：正文 ≥16px，触摸目标 ≥44px
│
├─ Tablet     宽度 ≥ 600 CSS px 且高度 ≥ 500 CSS px
│   最多 3 块面板同屏 + 可拖动分隔条 + 可折叠侧栏
│   组件尺寸：与 Phone 完全相同（不缩小！）
│   差异体现在「信息密度」而非「控件大小」
│
└─ Desktop    宽度 ≥ 1280 CSS px
    上游现有布局，一行不改
```

**"平板不是手机放大"的具体含义**（这是 Q1 的核心要求）：

| 维度 | Phone | Tablet | 说明 |
| :--- | :--- | :--- | :--- |
| 同屏面板数 | 1 | 2–3 | 时间线 + 参数面板**同时可见**（互斥页签只在手机上） |
| 面板分配 | 全屏 | **可拖分隔条**由用户分配比例 | 参照 FLM 的 dockable 思路 |
| 轨道头信息 | 只显示轨道名 + `C` | 增加：clip 数、时长、算法标签 | 密度提升，不放大控件 |
| 参数面板钢琴键 | 窄（约 32 px） | 宽（约 56 px）+ 音名标注 | 信息量提升 |
| 工具栏 | 精简 + 汉堡菜单 | 展开为图标行 | |
| 第三方面板 | 页签切换 | 右侧可折叠侧栏常驻 | 文件浏览器/工程设置 |
| 触摸目标 | ≥44 px | **≥44 px（不缩小）** | 平板也是手指操作 |
| 正文 | 16 px | **16 px（不缩小）** | |
| 时间线默认缩放 | 更"放大"（每屏显示更少时间） | 更"缩小"（每屏显示更多时间） | 利用大屏的面积优势 |

> **反向要求（很重要）**：平板布局**不允许**为了塞下更多内容而把控件或字号缩小到桌面尺寸。平板的价值是"同屏更多面板 + 更多信息密度"，不是"回到桌面密度"。这条要写进 code review 检查项。

### 2.3 布局切换的实现

复用 `docs/01` ADR-005 的策略：**新增 `frontend/src/components/mobile/` 与 `frontend/src/components/tablet/`**，桌面组件不动。

```
frontend/src/components/
├── mobile/                    ← 新增：Phone 外壳
│   ├── MobileTopBar.tsx
│   ├── BottomTabs.tsx
│   ├── PlaybackBar.tsx
│   ├── FloatingActionBar.tsx
│   └── MobileSheet.tsx
├── tablet/                    ← 新增：Tablet 外壳
│   ├── DockableWorkspace.tsx      ← 可停靠面板容器
│   ├── SplitDivider.tsx           ← 可拖动分隔条（触摸目标 ≥ 12px 宽 + 44px 高）
│   └── CollapsibleSidebar.tsx     ← 可折叠侧栏
└── layout/                    ← 上游原有，一行不改
```

断点判定入口（单点收口，避免散落判断）：

```ts
// frontend/src/touch/layoutMode.ts
export type LayoutMode = "phone" | "tablet" | "desktop";
export function resolveLayoutMode(w: number, h: number, forced?: string): LayoutMode {
    if (forced) return forced as LayoutMode;        // ?layout=phone 便于调试
    if (w >= 1280) return "desktop";
    if (w >= 600 && h >= 500) return "tablet";
    return "phone";
}
```

监听 `ResizeObserver`（**不要**用 `window.innerWidth`，会强制同步布局）+ `visualViewport` 处理软键盘。

---

## 3. Q2 / Q4 落地：模型分发与打包

### 3.1 模型分包（离线可用）

| 包 | 内容 | 分发方式 | 缺失时的降级 |
| :--- | :--- | :--- | :--- |
| **内置（必装）** | `nsf_hifigan/pc_nsf_hifigan.onnx`(54 MB) + `config.json` | 直接进 APK | — |
| **可选包 A** | `hnsep/hnsep.onnx`(88 MB) + `config.yaml` | 应用内下载 **或** 从本地文件导入 | 禁用「气声 / 张力」编辑，参数面板对应控件置灰并说明原因 |
| **可选包 B** | `fcpe/fcpe.onnx`(41 MB) | 应用内下载 **或** 从本地文件导入 | 音高分析退回 WORLD Harvest/DIO（精度略降，速度下降） |

**"离线可用"的具体保证（Q2 的硬要求）**：
1. 本地文件导入通道**必须与下载通道同等完整**——用户从电脑拷一个 `.onnx` 进来就能用，不要求联网。
2. 下载完成后**永久离线可用**，不做授权校验、不做联网心跳。
3. **不做"必须联网才能启动"的设计**（不引入账号体系、不做启动时版本检查阻断）。
4. 模型包格式用简单的「单个文件 + 校验和」，例如 `hnsep.onnx` 配一个 `hnsep.onnx.sha256`；导入时校验，避免半个文件导致崩溃。
5. `docs/02` §3.3 的 `is_available()` 降级分支已经存在，不需要新写判空逻辑。

**存储影响提示**：内置 54 MB + 两个可选包 129 MB = 首次全装 183 MB，加上 `app_data_dir` 里的副本（因为要从 assets 拷出来，见 `docs/02` §3.2），**实际占用约 240 MB**。设置页应显示占用并提供"清理未使用的模型"。

### 3.2 Q4：只出 arm64-v8a

| 项 | 决定 |
| :--- | :--- |
| ABI | **仅 `arm64-v8a`** |
| 覆盖范围 | 2016 年后的绝大多数 Android 真机（arm64 已是绝对主流） |
| 收益 | APK 里 `libonnxruntime.so` + `libSoundTouchDLL.so` + Rust 库只打一份；避免 universal APK 体积翻倍 |

#### ⚠️ 2026-09-18 实测补充：这个决定让**模拟器装不了发布包**

原本的对策是"AVD 全部用 arm64 镜像"，但实测发现这条路**根本走不通**：

```
FATAL | Avd's CPU Architecture 'arm64' is not supported by the QEMU2 emulator on x86_64 host.
        System image must match the host architecture.
```

**x86_64 宿主机上的 Android 模拟器不支持 arm64 系统镜像** —— 不是"慢"，是直接拒绝启动。
（`emulator -accel-check` 显示 WHPX 可用，但 WHPX 只能加速 x86/x86_64 镜像，对 arm64 无效。
Google 已经取消了 x86 宿主对 arm 镜像的跨架构模拟支持。）

**因此测试分工修正为**：

| 验证内容 | 环境 | 说明 |
| :--- | :--- | :--- |
| 排版 / 断点 / 三套布局 | **桌面 Chrome（L0）** | 秒级反馈，覆盖绝大多数 UI 工作 |
| 手势数学与状态机 | **单元测试** | 见 [docs/08 §8.1](08-双指手势与视口内核对接规范.md) |
| **模拟器集成测试** | **x86_64 镜像 + 本地临时的 x86_64 debug 构建** | `npx tauri android dev --target x86_64`；WHPX 加速，可用 |
| arm64 真实行为（音频、性能、ABI、OOM） | **真机** | 唯一可信环境 |

**关键边界**：那份 x86_64 包**只用于本地调试，绝不进发布产物**。
发布仍严格按 ADR-009 只出 `arm64-v8a`。这样既满足"用虚拟机测"的诉求，又不违反发布决定。

> 代价：本项目不能只依赖模拟器。音频与性能这类"移动端最容易翻车"的部分必须在真机验证。

### 3.3 Q4 的附带结论：arm64 系统镜像可以删掉

如果确定走 x86_64 模拟器路线，`D:\Android\Sdk\system-images\android-35\google_apis\arm64-v8a\`
（约 1.5 GB）就是纯粹的死重量，可以回收：

```bash
sdkmanager --uninstall "system-images;android-35;google_apis;arm64-v8a"
```

---

## 4. ⚠️ 两处结论更正（基于后续核实）

核实方法：在 `develop` 树上直接查文件与提交，而非看分支 diff。

### 4.1 更正一：`feature/waveform-webgl2-renderer` 不需要摘——**develop 已经有更完整的 WebGL2 渲染内核**

`docs/00` 曾把它列为"值得评估"。**这条作废。**

`develop` 里已有的东西：

| 位置 | 内容 |
| :--- | :--- |
| `frontend/src/components/layout/renderKernel/gl/` | `glContext` / `glRaster` / `instanceBuffer` / `instanceLayout` / `glyphProgram` / `sdfBoxProgram` / `polylineProgram` / `polylineGeometry` / `polylineDecimation` / `polylineCoverage` |
| `frontend/src/components/layout/renderKernel/glyph/` | 字形图集、布局（含截断）、光栅化 |
| `frontend/src/components/layout/renderKernel/` | `renderLoop`（请求式帧调度）、`scrollKernel`、`scrollbars`、`timelineAxis`、`canvasRaster` |
| `frontend/src/waveform/` | `surfaceRenderer`、`sceneBuilder`、`geometry`、`waveformPerf.bench.ts` |
| `frontend/src/components/layout/timeline/TimelineWaveformSurface.tsx` | 时间线波形 GL 表面 |
| `frontend/src/components/layout/pianoRoll/PianoRollWaveformSurface.tsx` | 参数面板波形 GL 表面 |
| `frontend/src/components/layout/pianoRoll/kernel/` | 参数编辑器自己的 GL 内核（glyph / scene / host / dragArithmetic / gestureHitTest） |

并且：
- 提交 `0217bad1 refactor(kernel): 移除四个内核开关与相关界面（内核唯一路径 · 阶段 4）` → **内核已是唯一路径，旧实现已删除**，没有开关需要处理。
- 提交 `269e5a9c Merge feature/timeline-unified-render-kernel` → `feature/timeline-unified-render-kernel` **已并入 develop**（所以 `docs/00` 里"不建议在移植期合并"那条也不需要了）。
- `docs/plans/2026-08-31-timeline-waveform-perf-design.md` 已经在针对**移动端最关心的那个瓶颈**做优化：*"10 轨道 / 400 clip / 1 分钟音频 / 全览缩放"下缩放与平移卡顿*，并已确定"平移复用走 shader uniform 方案"。

**为什么原来的 diff 数字误导了我**：`docs/00` 表里用的是「相对 `main` 的 diff」。`main` 停在 2026-08-31，而该分支停在 2026-07-29——**分支比 main 还旧**，所以 diff 里包含了"把 main 新做的东西回退掉"的部分。真实数字是：

| 分支 | 相对 `main`（原表，误导） | 相对 `develop`（真实） |
| :--- | :--- | :--- |
| `feature/waveform-webgl2-renderer` | 411 文件 / +17,161 −85,449 | **658 文件 / +27,918 −176,113** → 它是"退回旧架构"，已无价值 |
| `feature/timeline-unified-render-kernel` | 432 文件 / +76,934 −12,249 | 211 文件 / +8,800 −24,022 → **已并入** |
| `fix/frontend-render` | 495 文件 / +96,421 −17,213 | 22 文件 / +69 −768 → **已并入** |
| `feature/tools` | 500 文件 / +100,281 −17,510 | **44 文件 / +3,962 −1,098** → 差异很小，将来想摘取是可行的 |

**结论**：`docs/00` 的分支表应改用「相对 develop」判断。已在该文件顶部加入更正说明。

### 4.2 更正二：**双指纵横缩放所需的内核 API 已经全部存在**

`docs/03` 原先假设"需要自己实现手势识别与视口写入"。核实后发现 `scrollKernel` 已经提供了**恰好对应用户需求**的原子入口，包括一个专门为解决"纵向缩放指针漂移"而写的方法。详见 `docs/08`。

这条把 `docs/03` 里"自己实现 pinch 识别 + 视口状态管理"的工作量**大幅下调**，也让 Q1 要求的"纵横独立缩放、中心为两指中点"变成"把手势接到已有 API"，而不是新建一套视口数学。

---

## 5. Q6 落地：GitHub 操作步骤

> 你已经明确：需要真 fork，但**提交与设为公开由你操作**。因此我这边只做到"本地准备完毕"，把需要凭据的步骤留给你。

### 5.1 完整步骤（按顺序）

**步骤 1 —— 你在网页端创建 fork**（需要登录）
1. 打开 https://github.com/ARounder-183/HiFiShifter
2. 右上角 **Fork** → 创建到你的账号下
3. 建议把仓库名改成 `HiFiShifter-mobile`（避免与上游同名，也表明这是移植版）

**步骤 2 —— 我这边配置 remote 与分支**（无需登录，我可以直接做）
```bash
cd upstream-src
# 上游保持为 upstream，不动
git remote add origin https://github.com/<你的账号>/HiFiShifter-mobile.git
# 把 develop 推到 fork（远端默认分支名可自定，建议 develop）
git push -u origin develop:develop
```
> ⚠️ 但 `git push` **会要求凭据**——这是**第一个需要你登录的时刻**。

**步骤 3 —— 加移植层目录并首次提交**（无需登录）
```bash
# 在 fork 里追加 android/ docs/ scripts/ 与 README
git add android docs scripts README.md
git commit -m "chore: android port plan and adaptation layer skeleton"
```
我可以帮你把这一步的 commit 准备好。

**步骤 4 —— 你决定何时 push 与何时公开**
- `git push`：**第二个需要你登录的时刻**
- 仓库可见性：GitHub 上 **Settings → General → Danger Zone → Change visibility**，默认 fork 是公开的；若要设为私有，fork 后会继承上游的公开属性，需要手动改

### 5.2 需要你登录 GitHub 的时刻清单（我会在这些点提醒你）

| # | 时刻 | 操作 | 谁来做 |
| :--- | :--- | :--- | :--- |
| 1 | 创建 fork | 网页端点 Fork | **你（需登录）** |
| 2 | 首次 `git push` | 终端输入凭据 / PAT | **你（需登录）** |
| 3 | 后续每次 `git push` | 若已配置 PAT 或 SSH key，则无需再登录 | 你决定 |
| 4 | 修改仓库可见性 / 发 Release | 网页端 | **你** |

### 5.3 建议（可选）

- 用 **SSH key** 而不是 HTTPS + PAT：`git remote set-url origin git@github.com:<账号>/HiFiShifter-mobile.git`，配好后 push 不需要每次输凭据。
- 我用的是 `upstream` 这个名字指上游（`docs/00` 已改），这与 GitHub 的 fork 惯例一致：`origin` = 自己的 fork，`upstream` = 原仓库。
- **LICENSE 与版权声明**：fork 后保留上游 `LICENSE`；README 里注明"基于 ARounder-183/HiFiShifter（MIT）"。另外上游动态链接 LGPL 的 SoundTouch，发布时需保留其许可证声明。

---

## 6. 对已交付文档的影响（本次已同步修改）

| 文档 | 改动 |
| :--- | :--- |
| `docs/00` | 分支表加入更正说明：改用「相对 develop」判断；`feature/waveform-webgl2-renderer` 与本分支相关结论作废；`feature/timeline-unified-render-kernel` 标注已并入 |
| `docs/01` | §5 卡点更新（`resource_dir()` 已确认为事实；新增"渲染已 GPU 化"这一去风险项）；ADR-006/007 按 Q1 更新为三套布局 |
| `docs/03` | §4 手势实现改为"对接已有 `scrollKernel` API"，指向 `docs/08` |
| `docs/04` | §2 断点与 §3 骨架改为三套布局（Phone / Tablet / Desktop），平板规范按 FLM 式 |
| `docs/05` | 环境矩阵改为 arm64-only；AVD 改用 arm64 镜像；补模型导入/下载的测试场景 |
| `docs/06` | Q1–Q7 全部标记为已决策；新增 ADR-009 ~ ADR-013；风险表按新信息调整 |
| `README.md` | 结论摘要更新；加入 GitHub 登录时刻提醒 |

新文件：
- `docs/07-决策落地与FLM式自适应布局.md`（本文件）
- `docs/08-双指手势与视口内核对接规范.md`
