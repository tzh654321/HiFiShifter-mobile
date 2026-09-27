#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#9 关联文件：让本应用出现在系统的「打开方式」列表里。

用户口径：「在其他应用中打开本软件支持导入/打开的文件时，点以什么应用打开时 要能看到该软件」。

做法就是一组 `ACTION_VIEW` 的 intent-filter。要点：

* `.hshp` / `.hsp` **没有注册的标准 MIME**（不像 .mp3 有 audio/mpeg），
  所以文件管理器多半把它归到 `application/octet-stream`。因此除了按类声明
  （json / zip / audio/*），还要带上 `application/octet-stream` 这个兜底，
  否则工程文件的"打开方式"里根本不会出现本应用。
* 同一 `<intent-filter>` 内：**同类型属性之间是 OR、不同类型之间是 AND**。
  所以 `content|file` × `各种 mimeType` 的组合正是我们要的
  （"来自 content 或 file 的、这些类型之一的文件"）。
* `MainActivity` 已经是 `launchMode="singleTask"` + `exported="true"`，
  适合接收外部分享/打开，不用改。

⚠️ 这份 Manifest 在 `gen/` 下，`tauri android init` 会覆盖 —— 已同步写进
`scripts/setup-gen-android.sh`（§13）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MF = ROOT / "upstream-src" / "backend" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "AndroidManifest.xml"

FILTER = """
            <!-- ── HS-ASSOC-FILES（2026-09-24，见 TASKS.md #9）────────────────────
                 让本应用出现在「打开方式」里。见注入脚本 §13 的说明。 -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <!-- 工程文件：hshp/hsp 无标准 MIME ⇒ 靠这几种兜底 -->
                <data android:mimeType="application/json" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
                <!-- 音频 / MIDI -->
                <data android:mimeType="audio/*" />
                <data android:mimeType="audio/midi" />
            </intent-filter>
"""

t = MF.read_text(encoding="utf-8")
if "HS-ASSOC-FILES" in t:
    print("· AndroidManifest.xml 已有关联文件 filter")
else:
    anchor = """                <!-- AndroidTV support -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>"""
    assert t.count(anchor) == 1, "MAIN filter 锚不唯一"
    t = t.replace(anchor, anchor.replace("        </activity>", FILTER.rstrip("\n") + "        </activity>"), 1)
    MF.write_text(t, encoding="utf-8")
    print("✓ AndroidManifest.xml：加 ACTION_VIEW 的 intent-filter")
