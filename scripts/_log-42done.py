#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记录 #42 的真凶与正解。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MEM = ROOT / ".workbuddy" / "memory" / "2026-09-22.md"
MEM.write_text(MEM.read_text(encoding="utf-8") + """

---

## #42 收官（22:34-23:05）—— **找到真凶，已修好并验证**

### ⚠️ 前两轮的排查方向**全错**，值得记

我一直在查 **Radix DropdownMenu**（`MenuBar.tsx`，桌面端）：
改判据、加 `avoidCollisions={false}`、加内联 `maxWidth` —— **全是白费**。

**真凶在手机端**：`MobileTopBar.tsx` —— 手机菜单**根本不用 Radix**，
是同一个语义的**触摸实现**（自己 `position: absolute` 定位）。

⇒ **教训**：这个项目的 UI **手机端与桌面端是两套独立实现**
（memory 里写过"平板不复用手机布局"，但**顶栏菜单也是两套**）。
排查 UI 问题**先确认是哪一套在渲染**，再动手。

### 真凶（L660）

```ts
// 宽菜单（「视图」约 300px）放不下时靠右上角。
setAnchorRight(textLeft + 300 > window.innerWidth);
```

`300` = **最宽菜单（「视图」）**的估计，却对**所有**菜单用：

| 菜单 | textLeft | 判据 `+300` | 实际宽 | 应有 |
| :--- | ---: | :--- | ---: | :--- |
| 文件 | 13 | 313 ⇒ start | ~150 | start ✓ |
| 编辑 | 59 | 359 ⇒ start | ~180 | start ✓（**贴临界，差 1px 就翻**）|
| **轨道** | **105** | **405 ⇒ end** ❌ | **168** | **start** |
| 视图 | 151 | 451 ⇒ end | ~224 | end ✓ |
| 选项 | 197 | 497 ⇒ end | ~220 | end ✓ |
| 帮助 | 243 | 543 ⇒ end | ~120 | end ✓ |

⇒ **「轨道」被误判**：`105+168=273 < 360` 明明放得下。

### 正解：`useLayoutEffect` 实测宽度

**先按左对齐渲染，再在 paint 之前量真实宽度，溢出才切靠右。**

```ts
const menuPanelRef = React.useRef<HTMLDivElement|null>(null);
React.useLayoutEffect(() => {
    if (!openMenu) return;
    const el = menuPanelRef.current; if (!el) return;
    const w = el.getBoundingClientRect().width;
    const overflow = anchorLeft + w > window.innerWidth;
    setAnchorRight(prev => prev === overflow ? prev : overflow);   // 值不变 ⇒ bail out，不死循环
});
```

`useLayoutEffect` 在 **paint 前**同步跑 ⇒ **用户看不到修正那一帧，无跳动**。

⚠️ **不用"按项数估算"**：`MENUS` 只是名字数组（`menu_file`/`menu_track`…），
菜单项散在渲染函数里、**拿不到"有几项"**。硬编码项数表 = 又埋一个会过期的常数
（那正是 #42 的病根）。**实测是唯一永远准的办法。**

### 验证（模拟器 360×731）

| 菜单 | 结果 |
| :--- | :--- |
| 轨道 | `menuLeft: 105`（= textLeft）**左对齐 ✓**，截图确认菜单正挂在「轨道」下方 |
| 视图 | 宽 224、`menuRight: 356 ≤ 360` **withinViewport ✓** |

### 🕳️ 顺手捡到的坑

1. **`adb shell input tap` 的 y 坐标要加状态栏高度**。
   CDP 量 `getBoundingClientRect().top = 0`（WebView 内坐标），
   但设备坐标要从**状态栏之下**算起 ⇒ **差 72px**（`24dp` × dpr 3）。
   我按 CSS y 直接 tap，**点偏了整整 72px**、白折腾好几轮。
   正确：`devY = cssTop × dpr + 72`。
2. **顶栏按钮的 `x` 别按文字猜**。我第一次按"文字 === '轨道'"取到了别的元素
   （`x=96` 其实是**编辑**的位置，因为"编辑"的 `textContent` 也匹配了某层容器）。
   可靠办法：一次把所有按钮的 `textContent + rect` 打出来看。
3. **模拟器的「Pixel 启动器没有响应」弹窗会吃掉 `input tap`**，
   表现为"点了没反应"，容易误判成代码问题。
""", encoding="utf-8")
print("✓ memory 已追加")
