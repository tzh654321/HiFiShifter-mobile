# android/ · 移动端适配层

本目录**不参与上游构建**，只存放把上游代码变成 Android 可用版本所需的一切。

```
android/
├── README.md          ← 本文件
├── patches/           ← 对 upstream-src 的最小补丁（.patch），可重放
├── inject/            ← WebView 注入脚本（手势层、viewport、响应式开关）
└── notes/             ← 探针实测记录、机型基线数据
```

## 为什么用补丁而不是直接改上游

上游 `develop` 迭代极快（一周内 500 文件 / 9.7 万行变化）。直接 fork 改会在几个月内陷入冲突地狱。

补丁模式的约束（很重要，否则补丁会腐化）：

1. **每个补丁只做一件事**，并且能独立解释清楚为什么需要它。
2. **优先把平台判断收口到少数函数**，而不是到处加 `#[cfg]`。
   例如：`model_path()`、`resolve_input_path()`、`IS_ANDROID`。
3. **新增而不是修改**：移动端 UI 走 `frontend/src/components/mobile/`，桌面组件不改。
4. 补丁顺序固定，`apply-patches.sh` 按编号顺序应用。

## 用法

```bash
# 应用全部补丁到 upstream-src
bash scripts/apply-patches.sh

# 在 upstream-src 里改完后，把改动反向导出成补丁
bash scripts/export-patches.sh 0002-android-model-path
```

## 命名约定

```
patches/
├── 0001-build-target-android.patch          # Cargo.toml / build.rs 的 Android 目标
├── 0002-android-model-path.patch            # 模型路径收口
├── 0003-android-dialog-clipboard.patch      # 文件选择器 / 剪贴板
├── 0004-strip-windows-only.patch            # vslib / wasapi / 桌面剪贴板互导
├── 0005-android-ort-load-dynamic.patch      # ONNX Runtime 动态加载
└── ...
```

## 待办

见 [../docs/06-风险登记与决策记录.md](../docs/06-风险登记与决策记录.md) §5。
