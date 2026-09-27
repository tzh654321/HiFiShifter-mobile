#!/usr/bin/env python3
"""从截图里量出「应用顶栏从第几行开始」，用来判定系统栏有没有压住内容。

为什么需要它
------------
`docs/05` §8.5 定的验收标准是「看得到 + 点得到」，肉眼截图不算判据。
这个脚本把「看得到」这一步变成数字。

注意一个容易踩的坑：**不能靠颜色判断**。修 inset 之后，系统栏那一条的背景被
刻意设成了应用自己的窗口色（`hs_chrome` = 上游的 `--qt-window`），和菜单栏同色 ——
视觉上"融合"正是想要的效果，但也意味着那条和菜单栏在颜色上分不开。

所以改用**空间分布**：
  · 系统状态栏里，图标只出现在**左侧**（时钟）和**右侧**（信号/电量），
    中间那一大段是空的；
  · 应用自己的菜单栏，文字几乎铺满整个宽度，**中间一定有字**。
⇒ 「中部（默认 35%~65% 宽）第一次出现亮像素的行」就是应用顶栏的顶边。

判读
----
  · 该行 y ≈ 0..状态栏高度  → 被系统栏压住（未修复）
  · 该行 y ≈ 状态栏高度附近 → 正常（已修复）

用法
----
  python scripts/measure-inset.py <after.png> [before.png] [--status-bar 120]

  --status-bar  系统状态栏高度（px），来自 `adb shell dumpsys window displays`
                里的 `InsetsSource ... type=statusBars frame=[0,0][W,H]`。

退出码：0 = 判定正常；1 = 疑似被压住；2 = 用量错误。
"""
from __future__ import annotations

import argparse
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install pillow")


def row_signature(path: str, x_from=0.05, x_to=0.95, step=2):
    """逐行取平均亮度，作为该图的「垂直签名」。"""
    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()
    xs = range(int(w * x_from), int(w * x_to), step)
    n = len(list(xs))
    return [sum(px[x, y] for x in xs) / n for y in range(h)], w, h


def best_vertical_shift(before: str, after: str, d_max=400, y_from=0.10, y_to=0.80,
                        x_from=0.05, x_to=0.95, top_k=5):
    """求 after 相对 before 整体**下移**了多少像素。

    做法：比较 before 的第 y 行与 after 的第 y+d 行的行平均亮度，
    取让 MSE 最小的 d。界面整体下移时，这个 d 就等于被系统栏顶下来的距离。

    这是**不依赖颜色、不依赖内容横向分布**的判据 —— 即使系统栏背景被刻意设成
    与应用同色（视觉"融合"，正是想要的效果），签名法照样能测出位移。
    """
    sb, _, hb = row_signature(before, x_from, x_to)
    sa, _, ha = row_signature(after, x_from, x_to)
    y0, y1 = int(hb * y_from), int(hb * y_to)

    scores = []
    for d in range(0, d_max + 1):
        if y1 + d >= ha:
            break
        acc = 0.0
        n = 0
        for y in range(y0, y1):
            diff = sb[y] - sa[y + d]
            acc += diff * diff
            n += 1
        if n:
            scores.append((acc / n, d))
    scores.sort()
    return scores[:top_k]


def navband_content_rows(path: str, nav_top: int, xa=0.02, xb=0.25, sd_thresh=6.0):
    """数一下**导航栏条带里还有多少行是"有内容的"**。

    判据：左带（默认 x 2%~25%）逐行的亮度标准差。
    均匀背景 → 标准差≈0；有文字/图形 → 明显变大。

    左带是刻意选的：三键导航的图标在中部，右带可能有无障碍按钮，
    选左带能把系统 UI 自己的内容排除掉，只留下"应用画进这条带的像素"。
    """
    import statistics

    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()
    x0, x1 = int(w * xa), int(w * xb)
    rows = []
    for y in range(nav_top, h):
        vals = [px[x, y] for x in range(x0, x1)]
        rows.append((y, statistics.pstdev(vals), sum(vals) / len(vals)))
    noisy = [r for r in rows if r[1] > sd_thresh]
    return rows, noisy


def top_app_row(path: str, band=(0.35, 0.65), thresh=180, min_count=6) -> tuple[int, int, int]:
    """返回 (首个含应用内容的行 y, 该行亮像素数, 图像高度)。找不到返回 (-1, 0, h)。"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    x0, x1 = int(w * band[0]), int(w * band[1])
    px = im.load()
    for y in range(h):
        n = 0
        for x in range(x0, x1):
            r, g, b = px[x, y]
            # 亮像素（文字/图标）。用亮度而非单通道，兼容红/蓝系高亮。
            if 0.299 * r + 0.587 * g + 0.114 * b >= thresh:
                n += 1
                if n >= min_count:
                    return y, n, h
    return -1, 0, h


def bottom_app_row(path: str, band=(0.05, 0.95), thresh=180, min_count=6) -> int:
    """返回**最后**一行含应用内容的 y（从下往上找）。找不到返回 -1。

    底部用更宽的横向带：应用最底下那行状态文字（`运行时信息已更新`）靠左，
    不在中部。
    """
    im = Image.open(path).convert("RGB")
    w, h = im.size
    x0, x1 = int(w * band[0]), int(w * band[1])
    px = im.load()
    for y in range(h - 1, -1, -1):
        n = 0
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if 0.299 * r + 0.587 * g + 0.114 * b >= thresh:
                n += 1
                if n >= min_count:
                    return y
    return -1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("after", help="修复后的截图")
    ap.add_argument("before", nargs="?", help="修复前的截图（给了就打印位移）")
    ap.add_argument("--status-bar", type=int, default=None, help="状态栏高度(px)，给了就做判定")
    ap.add_argument("--nav-bar", type=int, default=None, help="导航栏高度(px)，给了就做底部判定")
    ap.add_argument("--band", default="0.35,0.65", help="中部探测带，比例，默认 0.35,0.65")
    ap.add_argument("--bottom-band", default="0.05,0.95", help="底部探测带，比例，默认 0.05,0.95")
    ap.add_argument("--thresh", type=int, default=180, help="亮度阈值，默认 180")
    ap.add_argument("--min-count", type=int, default=6, help="该行至少多少个亮像素才算，默认 6")
    ap.add_argument("--d-max", type=int, default=400, help="位移搜索上限(px)，默认 400")
    a = ap.parse_args()

    band = tuple(float(v) for v in a.band.split(","))
    if len(band) != 2 or not 0 <= band[0] < band[1] <= 1:
        return 2
    bband = tuple(float(v) for v in a.bottom_band.split(","))
    if len(bband) != 2 or not 0 <= bband[0] < bband[1] <= 1:
        return 2

    kw = dict(band=band, thresh=a.thresh, min_count=a.min_count)
    bkw = dict(band=bband, thresh=a.thresh, min_count=a.min_count)

    W, H = Image.open(a.after).size
    print(f"修复后 : {a.after}  （{W}x{H}）")

    rc = 0

    # ── 主判据：整体垂直位移搜索（不依赖颜色与横向分布）─────────────────
    if a.before:
        print(f"修复前 : {a.before}")
        cands = best_vertical_shift(a.before, a.after, d_max=a.d_max)
        print("\n【主判据】整体垂直位移搜索")
        print("          用行亮度签名找 after 相对 before 的下移量 d（界面被系统栏顶下来多少）：")
        for i, (mse, d) in enumerate(cands):
            print(f"            d={d:>4}  MSE={mse:8.2f}{'   ← 最佳' if i == 0 else ''}")
        best = cands[0][1] if cands else -1
        if a.status_bar is not None and best >= 0:
            sb = a.status_bar
            near = abs(best - sb) <= max(4, sb * 0.1)
            print(f"          期望 = 状态栏高度 {sb} px  ⇒ "
                  + ("✅ 一致：界面被顶下了整整一个状态栏"
                     if near else f"⚠️ 不一致（差 {best - sb:+d} px），请人工核对"))
            if not near:
                rc = 1
        else:
            print(f"          最佳位移 = {best} px（未给 --status-bar，仅报告不判定）")

    # ── 诊断：位置判据（可靠性有限，只作辅助）───────────────────────────
    y_after, n_after, _ = top_app_row(a.after, **kw)
    yb_after = bottom_app_row(a.after, **bkw)
    print("\n【诊断】位置判据（亮像素首行/末行）")
    print(f"          修复后：顶栏首行 y={y_after}（亮像素 {n_after}），内容末行 y={yb_after}")
    y_before = yb_before = None
    if a.before:
        y_before, n_before, _ = top_app_row(a.before, **kw)
        yb_before = bottom_app_row(a.before, **bkw)
        print(f"          修复前：顶栏首行 y={y_before}（亮像素 {n_before}），内容末行 y={yb_before}")
    print("          ⚠️ 这一项**不可单独当判据**：实测 ColorOS 的状态栏会在靠近中部的地方")
    print("             显示网速读数，正好落进探测带 ⇒ 会把状态栏自己的文字误判成应用顶栏。")
    if a.nav_bar is not None:
        nb = a.nav_bar
        limit = H - nb
        print(f"\n【底部判据】导航栏条带 y∈[{limit}, {H}) 内还有多少行是「有应用内容」的")
        print("             判据：左带（x 2%~25%）逐行亮度标准差 > 6 视为有内容（左带避开系统导航图标）")
        for tag, p in (("修复前", a.before), ("修复后", a.after)):
            if not p:
                continue
            rows, noisy = navband_content_rows(p, limit)
            last = noisy[-1] if noisy else None
            extra = (f"，最后一条 y={last[0]}（sd={last[1]:.1f}）" if last else "，✅ 整条带均一")
            print(f"             {tag}：{len(noisy)}/{len(rows)} 行{extra}")
            if tag == "修复后" and len(noisy) > len(rows) * 0.2:
                print("             🔴 应用内容仍大量落在导航栏条带里")
                rc = 1
        rows_after = navband_content_rows(a.after, limit)[0]
        print(f"             条带最底部均亮度 = {rows_after[-6][2]:.1f}"
              "（应等于窗口背景 hs_chrome ＝ 上游 --qt-window）")

    return rc


if __name__ == "__main__":
    sys.exit(main())
