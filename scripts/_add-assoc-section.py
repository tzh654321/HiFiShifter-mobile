#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""往 setup-gen-android.sh 插 §13：注入「关联文件」的 intent-filter。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = ROOT / "scripts" / "setup-gen-android.sh"

ANCHOR = '\necho\necho "── 自检 ──"'

SECTION = r'''
# ── 13. 关联文件（HS-ASSOC-FILES，2026-09-24）───────────────────────────────
# 用户口径：「在其他应用中打开本软件支持导入/打开的文件时，点以什么应用打开时
# 要能看到该软件」⇒ 就是给 MainActivity 加一组 ACTION_VIEW 的 intent-filter。
#
# 要点：
#   · `.hshp` / `.hsp` **没有注册的标准 MIME**（不像 .mp3 有 audio/mpeg），
#     文件管理器多半把它归到 `application/octet-stream` ⇒ 必须带上这个兜底，
#     否则工程文件的「打开方式」里根本不会出现本应用；
#   · 同一 `<intent-filter>` 内 **同类型属性之间是 OR、不同类型之间是 AND**，
#     所以 `content|file` × 各种 mimeType 的组合正是想要的语义。
#   · MainActivity 已是 `launchMode="singleTask"` + `exported="true"`，无需改。
echo
echo "── AndroidManifest.xml：关联文件 intent-filter ──"
MANIFEST="$GEN_DIR/app/src/main/AndroidManifest.xml"
if [ ! -f "$MANIFEST" ]; then
  echo "⚠️ 没找到 AndroidManifest.xml，跳过" >&2
elif grep -q 'HS-ASSOC-FILES' "$MANIFEST"; then
  echo "· 已注入过，跳过"
else
  python3 - "$MANIFEST" <<'PY' 2>/dev/null || echo "⚠️ 注入失败，请手工检查" >&2
import sys, pathlib
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
anchor = """                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>"""
add = anchor + """

            <!-- ── HS-ASSOC-FILES（由 scripts/setup-gen-android.sh §13 注入，勿手改）── -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/json" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
                <data android:mimeType="audio/*" />
                <data android:mimeType="audio/midi" />
            </intent-filter>"""
if anchor not in t:
    sys.exit(1)
p.write_text(t.replace(anchor, add, 1), encoding="utf-8")
PY
  if grep -q 'HS-ASSOC-FILES' "$MANIFEST"; then
    echo "✓ 已注入关联文件 intent-filter"
  else
    echo "❌ 注入失败，请手工检查 $MANIFEST" >&2
  fi
fi
'''

t = P.read_text(encoding="utf-8")
if "HS-ASSOC-FILES" in t:
    print("· §13 已存在")
else:
    idx = t.rfind(ANCHOR)
    assert idx > 0, "找不到锚（echo 自检）"
    P.write_text(t[:idx] + "\n" + SECTION + t[idx:], encoding="utf-8")
    print("✓ §13 已插入 setup-gen-android.sh")
