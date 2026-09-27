# M0 探针 · 技术卡点最小验证

对应 [docs/01 §5](../../docs/01-移植方案总览.md) 的四个卡点与 [docs/02 §4](../../docs/02-后端改造清单.md) 的 7 项验证。
**这个工程刻意与 `upstream-src` 完全隔离**——上游有 7 万行 Rust，把探针塞进去会在编译错误里淹死。

## 探针清单

| 编号 | 探针 | 验证什么 | 失败意味着 |
| :--- | :--- | :--- | :--- |
| 0 | `env` | `resource_dir()` / `app_data_dir()` 等实际返回值；那个"路径"是否含 `://` | 若 `resource_dir()` 返回真实路径，则 [docs/02 §3](../../docs/02-后端改造清单.md) 的模型搬迁方案可以简化 |
| 1 | `ndk` | `ndk_context` 全局是否已被 Tauri/wry 初始化 | 未初始化 → cpal/Oboe 与 AssetManager 都可能失败，需要在 `setup` 里手工注入 |
| 2 | `cpal` | 能否建立输出流并**真的出声**；顺便枚举设备能力（采样率/声道/格式） | **卡点 R1（生死线）**：失败则要么加 `oboe-shared-stdcxx`，要么升级 cpal 0.16+（AAudio），要么自写 AAudio 输出 |
| 3a | `ort_init` | `libonnxruntime.so` 能否 dlopen + `OrtGetApiBase` 版本检查通过（不需要模型） | **卡点 R2（生死线）**：失败则 ONNX 声码器全废，退化为纯 WORLD |
| 3b | `ort_model` | 加载真实 `.onnx` + 建 session + 查 EP | 若 3a 过而 3b 失败，问题在模型或 EP 而非运行时 |
| 4 | `assets` | 用 `AssetManager` 把 8 MB 从 APK assets 流式拷到 `app_data_dir`，量吞吐并外推 184 MB 耗时 | 卡点 R4：失败则模型的加载方案要换（[docs/01 §5](../../docs/01-移植方案总览.md) 的 5-B/5-C） |

## 怎么跑

### 前置

```bash
# 用仓库里的脚本一次配好（JDK / SDK / NDK / ABI 等）
source scripts/android-env.sh
```

### Android（真机）

```bash
cd probes/m0-probe/src-tauri

# 只需要 Rust 侧的探针时，先装 tauri-cli
cargo install tauri-cli --version "^2"

# 初始化 Android 工程（生成 gen/android，第一次会拉 Gradle）
cargo tauri android init

# 跑（会自动 build + install + 启动）
cargo tauri android dev
```

界面上一共 8 个按钮。**第一次建议直接点「跑全部」**，然后看输出。

### 看日志

两种方式，结果相同：

1. **界面上直接看**（`read_log` 轮询，400 ms 一次）
2. **logcat**（真机没终端时更可靠，也是崩溃时唯一线索）

```bash
adb logcat -c
adb logcat -s RustStdout:V RustStderr:V AndroidRuntime:E DEBUG:E Oboe:V AAudio:V
```

关键行都以 `[PROBE]` 开头。

### 桌面（可选，只用于快速迭代代码能否编过）

桌面上探针 1/4 会跳过，探针 3a 需要你自己指定 ONNX Runtime 动态库路径：

```bash
cargo run
```

## 交付物：把结果写回文档

跑完后请把 logcat 的 `[PROBE]` 段贴回来。要落地的结论是：

| 问题 | 记到哪 |
| :--- | :--- |
| `resource_dir()` 到底是什么 | `docs/02` §3.1 |
| `ndk_context` 是否可用 | `docs/02` §4 探针清单 |
| cpal 是否出声、设备能力 | `docs/06` 风险 R1 的处置 |
| `libonnxruntime.so` 的有效加载路径 | `docs/02` §1.2 |
| assets 拷贝吞吐 → 184 MB 耗时 | `README.md` 与 `docs/05` §6 的基线表 |

## 已知的、预期需要修的地方

写的时候 Rust 工具链还在装，所以**这份代码尚未编译过**。按可能性排序，第一次编译可能需要动的地方：

1. `probes.rs` 的 `ndk::asset::AssetManager::from_java` —— ndk 0.9 的确切签名（是否 `unsafe`、返回类型）需要按编译器提示修。
2. `jni` 0.21 的 `env.get_string(&JString)` 返回类型转换。
3. `ort::init_from(path).commit()` 在 rc.13 上的返回值形状（可能不需要 `.commit()`）。
4. `cpal::Sample::EQUILIBRIUM` 与 `build_and_play` 的泛型约束。

这些都是**编译器一跑就明确**的问题，不影响探针设计本身。
