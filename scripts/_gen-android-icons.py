#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用上游（= 电脑版）图标生成 Android 全套 launcher 图标。

源：`upstream-src/backend/src-tauri/icons/icon.png`（512×512，上游仓库自带，
就是桌面版用的那张）—— 这样手机与电脑图标一致。

生成三类（每类 5 个密度）：
  · `ic_launcher.png`            —— 传统方形图标
  · `ic_launcher_round.png`      —— 圆形（用椭圆 mask 裁）
  · `ic_launcher_foreground.png` —— 自适应图标前景层：
      画布是 **108dp**，但只有中心 **72dp** 是安全区（外圈会被各家的
      "圆形/方形/水滴"裁切吃掉）。所以内容要缩到 66.7% 并居中，否则
      在圆形裁切下边缘会被削掉。
"""
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "upstream-src" / "backend" / "src-tauri" / "icons" / "icon.png"
RES = ROOT / "upstream-src" / "backend" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res"

# 密度 → 传统图标边长（dp 48 的对应像素）
DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def main() -> int:
    if not SRC.is_file():
        print(f"✗ 找不到源图标：{SRC}")
        return 1

    raw = SRC.read_bytes()
    w, h = struct.unpack(">II", raw[16:24])
    print(f"源图标：{w}×{h}（{SRC.name}）")
    src = Image.open(SRC).convert("RGBA")

    made = 0
    for dens, size in DENS.items():
        d = RES / f"mipmap-{dens}"
        if not d.is_dir():
            print(f"  ⚠ 跳过 {dens}（目录不存在）")
            continue
        base = src.resize((size, size), Image.LANCZOS)

        # ① 方形
        base.save(d / "ic_launcher.png", "PNG")
        made += 1

        # ② 圆形：椭圆 mask（比 RoundedBox 更贴近各家 ROM 的圆形裁切）
        big = size * 4  # 先放大再画 mask，缩回来边缘更干净
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
        rnd = base.copy()
        rnd.putalpha(mask.resize((size, size), Image.LANCZOS))
        rnd.save(d / "ic_launcher_round.png", "PNG")
        made += 1

        # ③ 自适应前景层：108dp 画布，内容占中心 ~66.7%
        canvas = int(round(size * 108 / 48))
        inner = int(round(canvas * 0.667))
        fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        ic = src.resize((inner, inner), Image.LANCZOS)
        off = (canvas - inner) // 2
        fg.paste(ic, (off, off), ic)
        fg.save(d / "ic_launcher_foreground.png", "PNG")
        made += 1

        print(f"  ✓ mipmap-{dens}: {size}px 方形/圆形 + {canvas}px 前景")

    print(f"\n共生成 {made} 个 PNG")
    # 自适应图标还有一份 XML 入口，缺了的话系统不会用前景层
    anydpi = RES / "mipmap-anydpi-v26"
    if anydpi.is_dir():
        for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
            print(f"  · 自适应入口 {name}: {'存在' if (anydpi / name).exists() else '❌ 缺失'}")
    else:
        print("  ⚠ 没有 mipmap-anydpi-v26 目录（自适应图标入口缺失）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
