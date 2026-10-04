# HiFiShifter Mobile

把 [HiFiShifter](https://github.com/ARounder-183/HiFiShifter)（图形化人声编辑与合成工具）移植到 **Android** 的触屏版。
保留上游的时间线编辑与参数编辑内核，交互整体改成**手指可用**：手势取代鼠标键盘、分屏取代多窗口、
文件访问改为 SAF、shizuku 等多种方式。

> ⚠️ 非官方移植，且**仍在开发迭代中**，未做全链路测试，可能有 BUG。

| ![示例图 1](docs/screenshots/readme示例图 (1).jpg) | ![示例图 2](readme示例图 (2).jpg) |

## 与桌面版的主要差异

| | 桌面版 | 本移植版 |
| :--- | :--- | :--- |
| 交互 | 鼠标 + 快捷键 | **全手势**（无键盘快捷键） |
| 布局 | 两块面板常驻 | 手机 `<1280px` 单面板；屏幕够宽时上下**分屏** |
| 文件 | 直接读写路径 | 系统 **SAF**（不申请存储权限） |
| 平台 | Windows / macOS / Linux | **Android 8.0+（API 26）**，**仅 `arm64-v8a`** |
| 后台播放 | 支持 | **第一版不做** |

依赖修饰键的能力在移动端都换成了手势或工具：`Alt` + 拖（伸缩 / 内部偏移）、右键（还原 / 框选）、
`Shift`（临时关吸附）；复制 / 剪切 / 粘贴 / 删除收进音频块「常用操作」条与工具栏。

## 安装

- Releases 下载 APK（`arm64-v8a`，Android 8.0+）直接安装；
- 或侧载：`adb install -r HiFiShifter-mobile-<version>-arm64-v8a.apk`。

首次启动会解压内置声码器模型（`nsf_hifigan`，约 54 MB），需要一点时间。

## 手势

**详细表格： [`docs/15-触屏交互规格表.md`](docs/15-触屏交互规格表.md)**
常用几条：

| 区域 | 单击 | 双击 | 划动 | 长按 | 长按并划动 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 轨道 | 切换轨道 | 展开全屏编辑 | 平移视野 | — | 相当于右键框选 |
| 音频块 | 选中 + 显示常用操作与控制点 | 展开全屏编辑 | 未选中：平移；已选中：拖动块；**淡变区**：调淡变 | **淡变区**：淡变菜单 | 拖动块 |
| 轨道头 | 切换轨道 | — | 上下：平移；**左划隐藏**（再右划展开） | 轨道菜单 | 移动轨道顺序 |
| 块两端控制点 | — | — | 改块起止位置 | 上方出淡入/淡出图标、下方出变速图标 | 上划后横滑调淡变 / 下划后横滑调变速 |
| 拍数栏 | 移动进度条 | 移动进度条并播放 | 平移视野 | — | — |

音频块上**双指长按并划动** = 调整音频相对于音频块的位置（内部偏移，相当于桌面版的 `Alt` + 拖）。
> 注：**两指都必须落在同一个音频块上**、且按下后**不要先移动**（约 0.5 s）才会进入该模式；

## 功能范围

- **轨道面板**：导入（内置文件管理器；视频自动取音轨）、拖动 / 裁剪 / 伸缩 / 内部偏移、淡入淡出、
  增益、静音、胶合、在播放头切分、轨道组嵌套（组内共用算法与参数线）。
- **参数面板**：类 VocalShifter 的音高线编辑 —— 实线 = 当前音高，虚线 = 整体原始音高，
  彩线 = 各音频块自己的原始音高；轨道上的 `C`（Compose）决定哪些轨道组参与调参。
- **算法**：`World`（仅音高）· `PC-NSF-HiFiGAN`（音高 / 气声 / 张力 / 共振峰 / 音量，气声需单独开启）·
  `Vslib`（音高 / 声像 / 共振峰 / 音量 / 气声）。原版的 `nsf_hifigan` 内置，`hnsep` / `fcpe` 需自行导入，目前的安卓版自带所有模型。
- **互通**：可直接打开 VocalShifter / Reaper 工程。

## 构建

前置：JDK 17 · Android SDK（平台 + NDK）· Rust（`aarch64-linux-android` target）· Node.js 20+。

```bash
scripts/apply-patches.sh          # 给上游快照打补丁
scripts/build-apk.sh arm64-v8a    # 真机包；x86_64 出模拟器包
```

产物：`upstream-src/backend/src-tauri/gen/android/app/build/outputs/apk/universal/debug/`。

> **补丁纪律**：`upstream-src/` 视为只读上游快照，前后端改动统一落 `android/patches/`。
> 改完源码必须 `scripts/regen-frontend-patch.sh` 并用 `scripts/verify-patches.sh` 确认逐字节一致。

## 文档与许可

- 许可：沿用上游 **MIT License**。致谢：HiFiShifter · WORLD · SoundTouch（LGPL）·
  Signalsmith Stretch（MIT）· VocalShifter Library (vslib) · SingingVocoders · HiFi-GAN。
