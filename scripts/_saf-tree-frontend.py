#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#8 批 3/3：前端 —— 默认目录 + 授权入口。

- 默认路径：Android 上首次进入文件浏览器落在 `/storage/emulated/0/HiFiShifter`
- 授权入口：读取失败（未授权 ⇒ EACCES）时，错误态里给一个按钮，调 SAF 选目录。
  授权成功**不用**换算路径 —— 直接重试同一个真实路径即可，Rust 侧会自动识别
  "这个路径落在已授权的 tree 里"并改走 SAF（见 `file_browser::list_directory`）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"
I18N = FE / "i18n"

DEFAULT_DIR = "/storage/emulated/0/HiFiShifter"

# ── ① 默认路径 ───────────────────────────────────────────────────────────────
sl = FE / "features" / "fileBrowser" / "fileBrowserSlice.ts"
t = sl.read_text(encoding="utf-8")
old = '''const STORAGE_KEY = "hifishifter.fileBrowser.lastPath";
const AUDIO_ONLY_KEY = "hifishifter.fileBrowser.audioOnly";

function getInitialPath(): string {
    return localStorage.getItem(STORAGE_KEY) || "";
}'''
new = '''const STORAGE_KEY = "hifishifter.fileBrowser.lastPath";
const AUDIO_ONLY_KEY = "hifishifter.fileBrowser.audioOnly";

/**
 * #8：Android 上文件浏览器的默认目录（用户口径）。
 *
 * ⚠️ 这是**用户可见**的路径，不是应用私有目录。Android 11+ 的分区存储下
 * 应用**不能**用真实路径读它，所以 Rust 侧会在检测到"该路径落在一个已授权的
 * SAF tree 里"时改走 SAF（`file_browser::list_directory`）。
 * 首次进入因为还没授权 ⇒ 会读失败 ⇒ 错误态会给出「授权访问」按钮。
 */
export const DEFAULT_ANDROID_MUSIC_DIR = "/storage/emulated/0/HiFiShifter";

function getInitialPath(): string {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    // 只在 Android 上给这个默认值；桌面端保持""（让用户自己挑目录）。
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    return isAndroid ? DEFAULT_ANDROID_MUSIC_DIR : "";
}'''
assert t.count(old) == 1, "getInitialPath 锚不唯一"
sl.write_text(t.replace(old, new, 1), encoding="utf-8")
print("✓ fileBrowserSlice.ts：Android 默认目录 = " + DEFAULT_DIR)

# ── ② 错误态加「授权访问」按钮 ───────────────────────────────────────────────
fb = FE / "components" / "layout" / "FileBrowserPanel.tsx"
t = fb.read_text(encoding="utf-8")
old = '''                    ) : fb.error ? (
                        <Text size="1" color="red" className="px-3 py-4 block text-center">
                            {(t as (key: string) => string)("fb_error")}: {fb.error}
                        </Text>
                    ) : !fb.currentPath ? ('''
new = '''                    ) : fb.error ? (
                        <Flex direction="column" align="center" gap="2" className="px-3 py-4">
                            <Text size="1" color="red" className="block text-center">
                                {(t as (key: string) => string)("fb_error")}: {fb.error}
                            </Text>
                            {/* #8：Android 上读 /storage/emulated/0/... 需要 SAF 授权。
                                授权成功后**直接重试原路径**即可 —— Rust 会自动识别并走 SAF。 */}
                            <Button
                                size="1"
                                variant="soft"
                                onClick={() => {
                                    void (async () => {
                                        const r = await fileBrowserApi.pickDirectory();
                                        if (r?.ok && !r.canceled) {
                                            void dispatch(loadDirectory(fb.currentPath));
                                        }
                                    })();
                                }}
                            >
                                {(t as (key: string) => string)("fb_grant_dir_access")}
                            </Button>
                        </Flex>
                    ) : !fb.currentPath ? ('''
assert t.count(old) == 1, "错误态锚不唯一"
t = t.replace(old, new, 1)

# 补 import（Button / Flex / fileBrowserApi）
if "loadDirectory" not in t.split("export function")[0]:
    pass
if "fileBrowserApi" not in t.split("\n")[0:60].__str__():
    import re
    m = re.search(r'import \{([^}]*)\} from "\.\./\.\./services/api/fileBrowser";', t)
    if m:
        t = t[:m.start(1)] + m.group(1).rstrip() + ", fileBrowserApi " + t[m.end(1):]
    else:
        t = t.replace(
            'import { useI18n } from "../../i18n/I18nProvider";',
            'import { useI18n } from "../../i18n/I18nProvider";\nimport { fileBrowserApi } from "../../services/api/fileBrowser";',
            1,
        )
if "import { Button" not in t and "Button," not in t:
    t = t.replace(
        'import { Flex, Text }',
        'import { Button, Flex, Text }',
        1,
    )

fb.write_text(t, encoding="utf-8")
print("✓ FileBrowserPanel.tsx：错误态加「授权访问」按钮")

# ── ③ i18n ×5 ───────────────────────────────────────────────────────────────
KEYS = {
    "zh-CN": "授权访问目录",
    "zh-TW": "授權存取目錄",
    "en-US": "Grant folder access",
    "ja-JP": "フォルダへのアクセスを許可",
    "ko-KR": "폴더 접근 권한 부여",
}
for loc, val in KEYS.items():
    f = I18N / f"{loc}.ts"
    text = f.read_text(encoding="utf-8")
    if "fb_grant_dir_access:" in text:
        print(f"  · {loc}.ts 已有该键")
        continue
    anchor = "\n} as const;"
    assert anchor in text, f"{loc}.ts 找不到锚"
    text = text.replace(anchor, f'\n    fb_grant_dir_access: "{val}",\n{anchor}', 1)
    f.write_text(text, encoding="utf-8")
    print(f"  ✓ {loc}.ts + fb_grant_dir_access")
