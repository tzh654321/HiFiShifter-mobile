#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本轮三条教训追加进 tauri2-android-bringup skill。"""
from pathlib import Path

P = Path("C:/Users/tzh/.workbuddy/skills/tauri2-android-bringup/SKILL.md")
t = P.read_text(encoding="utf-8")

ADD = """

---

## 手机端与桌面端是**两套平行实现** —— 改 UI 前先确认渲染的是哪个组件

**2026-09-25 实测**（HiFiShifter 移植：删底栏 #17）。栽了两轮构建才找到，值得单列。

### 现象

在 `components/layout/MenuBar.tsx` 的「视图」菜单里加了 4 个菜单项，
**手机上死活不出现**。tsc 全绿、代码确实在、菜单 DOM 里就是没有。

### 根因

`components/mobile/MobileTopBar.tsx` 的**第一行注释**写着：

> 桌面 MenuBar 的语义保留（文件/编辑/轨道/视图/选项/帮助）。

⇒ **手机顶部是它自绘的一套触摸实现，`MenuBar` 在手机上根本不渲染。**
它内部的 `menu_view: [...]` 数组才是手机「视图」菜单的真正内容。

⇒ 判据：**手机上看到的一切基本都在 `components/mobile/` 下**；
`components/layout/` 里的桌面组件（`MenuBar` / `ActionBar` / 各种 Panel）
在手机上大多不渲染，或只渲染一部分。**i18n key 也可能是两套**
（桌面 `menu_view_panel_*` vs 手机 `file_panel` / `notebook`）。

⚠️ 更阴的是：`MenuBar`（桌面）与 `MobileTopBar`（手机）**不一定都渲染**，
取决于 `isPhone` / `isTablet` / `isTouchShell` 的分支。
⇒ **先 CDP 查一下「这个 DOM 属于哪个组件」再动手**，比读代码猜快得多。

### 同类表现：注释说能用、代码却按形态限制

`MobileTopBar` 的 `menu_view` 里本来就有：

```
{ label: t("file_panel"), action: onToggleFiles },
{ label: t("notebook"),   action: onToggleNotebook },
```

注释写着「**手机也能开合**」，但 App 传的是：

```tsx
onToggleFiles={isTablet ? () => dispatch(toggleFileBrowserVisible()) : undefined}
```

⇒ **手机上拿到 `undefined`，点了没反应。**
**看到「注释说能用、代码却按形态限制」的地方，多半是没接完。**

---

## 两个会静默失效的写法

### 1. CSS 类选择器打不过**内联样式**

给按钮加类 `.hs-edit-btn` 后写：

```css
body[data-menu="open"] .toolrow .hs-edit-btn { display: none; }
```

**没生效** —— 实测 `getComputedStyle(el).display` 仍是 `flex`。
因为该按钮的 `display: "flex"` 写在 **React `style={{...}}` 里 = 内联样式**，
优先级高于任何类选择器。

⇒ 要么改内联、要么 `display: none !important`。
**排查手法**：`getComputedStyle(el, null).display` 一眼看出谁赢了。

### 2. Redux slice 的 actions 是**解构导出**的

reducer 写进 `reducers: {}` **还不够**，必须在文件末尾的：

```ts
export const { ... } = sessionSlice.actions;
```

列表里**再加一行**，否则别处 `import { myAction }` 会报
`Module has no exported member 'myAction'` ——
而且 **slice 自身编译是过的，错误只在「使用方」冒出来**，
很容易误判成 import 路径或拼写问题。（这次卡了两轮构建。）

同理，如果组件用**显式字段**的 `useAppSelector`（返回字面量对象），
新增 `s.xxx` 前要先把 `xxx` 加进那个对象，否则 `Property 'xxx' does not exist`。

---

## 构建失败先 `df`，再看代码

**症状**：gradle 任务报：

```
java.io.IOException: ´ÅÅÌ¿Õ¼ä²»×ã¡£
```

那串是 **GBK 被当 Latin-1 解码**的乱码，原文是 **`磁盘空间不足。`**

⇒ **构建报出「看不懂的乱码」时，第一件事 `df -h /c /d`。**
Android 构建（gradle + rustc + 打包 APK）单个 ABI 就要吃几 GB，
而开发机 C 盘常在个位数 GB 徘徊 —— 全量构建足以把它压到 0。

⚠️ 清理时注意：很多环境里 **删除会进回收站、不释放空间**；
真释放只有 `Clear-RecycleBin`（异步，可能几分钟后才见效）
或对文件 `truncate -s 0`（截断 ≠ 删除）。
**别动正在用的 AVD** —— 一个 phone AVD 能占 9G。
"""

t = t.rstrip() + ADD
P.write_text(t, encoding="utf-8")
print("✓ skill 追加 3 节（手机/桌面平行实现、两个静默失效、构建先 df）")
print("总行数:", len(t.splitlines()))
