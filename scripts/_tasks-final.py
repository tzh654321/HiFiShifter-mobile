#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""收尾：更新 #4（已验证）/ #7（三个 bug 已修，待实测）+ 记录构建坑。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "TASKS.md"
t = P.read_text(encoding="utf-8")

# ── #4：从 WIP 升级为「已验证」────────────────────────────────────────────────
line4 = next((l for l in t.splitlines() if l.startswith("| 4 |")), None)
if line4 and "已验证" not in line4:
    t = t.replace(line4,
        "| 4 | 模型全内置 + 隐藏模型管理 | ✅ **已完成并实测验证**。`hnsep.onnx`(92.6MB)/`fcpe.onnx`(43.3MB) "
        "一直在源码树里，只是 ADR-012 从 `bundle.resources` 摘掉了 ⇒ 往 `tauri.android.conf.json` 补三条即可，"
        "**无需改 §⑤.5**（它按 conf 文本推导期望目录）。APK **163 → 298.5 MB**。"
        "模型管理入口**两处**（`MenuBar` 桌面/平板 + `MobileTopBar` 手机）按 `HS_MODELS_BUNDLED` 隐藏。"
        "✅ **实测**：① 私有目录里 `fcpe.onnx`/`hnsep.onnx`/`config.yaml` 已物化；"
        "② 运行日志显示 **三个模型全部成功建会话**"
        "（`ort_session[Vocoder]: pc_nsf_hifigan.onnx` / `[PitchDetector]: fcpe.onnx` / `[Separator]: hnsep.onnx`）；"
        "③ 两个菜单 `含模型管理: false` | A | DONE:09-24 |", 1)

# ── #7：记录二次修复 ─────────────────────────────────────────────────────────
line7 = next((l for l in t.splitlines() if l.startswith("| 7 |")), None)
if line7:
    t = t.replace(line7,
        "| 7 | 直线/颤音画完显示横纵两个滑动条（横=波长，纵=振幅），点空白确认关闭 | "
        "✅ **代码完成 + 实测后的三个 bug 已修**（tsc 干净、构建装机通过、应用运行正常）。"
        "🔑 两个关键发现：① `vibratoStateRef` 五个清空出口**只有一个是「提交」**，钩子只挂一处；"
        "② **不用新建后端通道**，`buildVibratoDense`+`commitStroke` 就在同一 hook 里。"
        "**实测反馈的修复**：① 曲线公式是 `base + amplitude*sin(2π·freq·t)`，而 `vibratoStateRef` 初值 "
        "**`amplitude: 0`** ⇒ 拖波长时振幅仍是 0 ⇒ 画出来还是直线 ⇒ **拖波长时自动补一个可见默认振幅**；"
        "② 原来只在 `onChange` 里落盘（异步、无即时反馈）⇒ 改**节流提交**（拖动中 ~60ms，松手立即补）；"
        "③ `AMP_MAX` 原写死 1200（振幅单位是**值域单位**，对音高是半音，1200 完全离谱）⇒ "
        "改用 `currentParamRange` 算范围。"
        "⏳ **待你实测**：进「参数」页 → 切「直线/颤音」工具 → 画线 → 拖滑条看曲线是否实时变化。"
        "⚠️ 我用 CDP 模拟画线**能画出线但浮层没弹**（推测是当前 `drawToolMode` 不是 vibrato，"
        "而工具切换入口我找不到）| A | WIP:待实测 |", 1)

# ── 构建坑写进技术要点 ───────────────────────────────────────────────────────
anchor = "- 🔴 **`clean` 不是免费的**"
lesson = (
    "- 🔴 **改前端会触发 Rust 重编**（tauri 要把 `frontend/dist` 嵌进 `libbackend_lib.so`） ⇒\n"
    "  于是 `:app:rustBuildX86_64Debug` 必须真跑 ⇒ **撞上 `node.exe.bat` 那个坑**（详见 build-apk.sh ③.9）。\n"
    "  之前一直没暴露是因为该 task 常年命中 UP-TO-DATE。已固化：构建脚本自动摘掉 WorkBuddy 的 node。\n"
    "  ⚠️ 还要 `gradlew --stop` —— **daemon 的环境块启动时定型**，不重启 daemon 改了 PATH 也白改。\n"
)
if anchor in t and "改前端会触发 Rust 重编" not in t:
    t = t.replace(anchor, lesson + anchor, 1)

P.write_text(t, encoding="utf-8")
print("✓ TASKS.md：#4 → DONE / #7 记录二次修复 / 补「改前端触发 Rust 重编」要点")
