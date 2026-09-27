#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补上自适应图标（adaptive icon）的 XML 入口。

只有 PNG 是不够的：Android 8+ 的启动器会优先找 `mipmap-anydpi-v26/ic_launcher.xml`，
找不到就退回传统 PNG。上游 tauri-android 模板只给了 PNG，没有那个目录 ——
所以现在画出来的 `ic_launcher_foreground.png` 根本不会被用到。

配色取自图标自身：底色 `#17242C`（实测图标圆角内四点的颜色一致）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "upstream-src" / "backend" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

BG_COLOR_NAME = "hs_icon_bg"
BG_COLOR_HEX = "#17242C"  # 与 icons/icon.png 的底色一致

ADAPTIVE = """<?xml version="1.0" encoding="utf-8"?>
<!-- HS-ICON-PATCH：由 scripts/_gen-adaptive-icon-xml.py 生成 / setup-gen-android.sh 持久化 -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/{bg}" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
""".format(bg=BG_COLOR_NAME)

ADAPTIVE_ROUND = ADAPTIVE.replace(
    "</adaptive-icon>",
    "    <monochrome android:drawable=\"@mipmap/ic_launcher_foreground\" />\n</adaptive-icon>",
)


def ensure_color() -> None:
    f = RES / "values" / "colors.xml"
    if not f.is_file():
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'    <color name="{BG_COLOR_NAME}">{BG_COLOR_HEX}</color>\n</resources>\n',
            encoding="utf-8",
        )
        print(f"  ✓ 新建 values/colors.xml 并写入 {BG_COLOR_NAME}={BG_COLOR_HEX}")
        return
    t = f.read_text(encoding="utf-8")
    if BG_COLOR_NAME in t:
        print(f"  · values/colors.xml 已有 {BG_COLOR_NAME}")
        return
    t = t.replace("</resources>", f'    <color name="{BG_COLOR_NAME}">{BG_COLOR_HEX}</color>\n</resources>')
    f.write_text(t, encoding="utf-8")
    print(f"  ✓ values/colors.xml 追加 {BG_COLOR_NAME}={BG_COLOR_HEX}")


def main() -> int:
    d = RES / "mipmap-anydpi-v26"
    d.mkdir(parents=True, exist_ok=True)
    (d / "ic_launcher.xml").write_text(ADAPTIVE, encoding="utf-8")
    (d / "ic_launcher_round.xml").write_text(ADAPTIVE_ROUND, encoding="utf-8")
    print(f"  ✓ {d.name}/ic_launcher.xml")
    print(f"  ✓ {d.name}/ic_launcher_round.xml（含 monochrome，Android 13+ 主题图标）")
    ensure_color()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
