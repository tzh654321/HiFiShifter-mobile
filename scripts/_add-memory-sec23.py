#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 memory ㉓ 节（用 .py 文件写，避免反引号被 bash 吞掉）。"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent / ".workbuddy" / "memory" / "2026-09-22.md"

SEC = """

---

## ㉓ 工程保存失败的根因：`ACTION_CREATE_DOCUMENT` 不能收 `*/*`

**用户反馈**：工程文件保存**还是**有问题；但 **WAV 导出没问题**（用户的猜测是"因为我存在
无权限问题的 android/data 里"）。**用户的对比非常关键** —— 它把范围一下缩小到了一个字段。

### 根因

两条路径的 `save_file` **调用链完全相同**（`project.rs:save_project_as` 与
`dialogs.rs:pick_output_path` 都走 `FileDialog::save_file` → `saf::save_file`），
**唯一差异是 MIME**：

| 用途 | exts | `mime()` 结果 |
| :--- | :--- | :--- |
| WAV 导出 | `[wav]` | `audio/*`（**具体**）✓ |
| MIDI 导出 | `[mid]` | `audio/midi`（**具体**）✓ |
| **工程保存** | `[hshp, hsp, json, zip]` | **`*/*`** ✗ |

`mime()` 里只要 exts 含 `json` 就判定 `project = true`，而 `hshp`/`hsp` **不在它的匹配表里**，
于是落到"混合类型 ⇒ 只能放开"那条分支，产出 `*/*`。

**`ACTION_CREATE_DOCUMENT` 的 `type` 要求具体 MIME**；`*/*` 在部分 ROM（ColorOS 实测）
上会让创建流程异常、回传空 data ⇒ 我们在 `onActivityResult` 判成"用户取消" ⇒
前端显示「已取消保存」。**用户看到的"WAV 能存"正是因为 `audio/*` 是具体的。**

### 修法（两处，双保险）

1. **Rust**：新增 `save_mime()` —— 保存方向把 `*/*` 折成 `application/octet-stream`。
   ⚠️ **不能改 `mime()` 本身**：导入方向恰恰需要 `*/*`，否则用户在选择器里看不到目标文件
   （这条在"导入工程时选到 mp3"那次已经验证过）。**导入与保存对 MIME 的要求是相反的。**
2. **Kotlin**：`buildIntent` 的 `KIND_SAVE` 里再兜一层
   （`mime.takeIf { it.isNotEmpty() && it != "*/*" } ?: "application/octet-stream"`）。

### 顺带补的诊断日志

用户这次只能描述"还是同样的问题"，而真机又掉线了，**没有日志就等于盲猜**。
所以给整条保存链路补齐了打点：

- `[dialog] 另存为(…) → 用 MIME … 发起 CREATE_DOCUMENT`（能直接看出 MIME 对不对）
- `[HS-SAF] stagingDir: …`（它是 save_file 的前置，失败会直接变成"已取消"）
- `[HS-SAF] writeToUri: N B → content://…（stream=…）`
- `onActivityResult rc=… kind=1 resultCode=… hasData=… uri=…`

⇒ 下次无论哪一环出问题，**日志能直接指到具体那一步**，不用再来回猜。

**状态**：代码与构建已完成；**真机离线（USB/无线均不通），尚未装机验证** —— 待设备接上后
`pm install -r` 并复验"工程保存 → 文件真的写进去"。
"""

P.write_text(P.read_text(encoding="utf-8") + SEC, encoding="utf-8")
print("✓ ㉓ 节已追加")
