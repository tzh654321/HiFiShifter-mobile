#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""触屏表达修饰键语义（一次解决 slip / copy / 免吸附）。

## 问题

`timelineKernelHost.ts:2825` 写明：
> （`dragModifiersOf`：**Ctrl/Shift/Alt/⌘ 决定 copy / slip / 免吸附等语义**）

而它读的是 `PointerEvent` 的 `ctrlKey/shiftKey/altKey/metaKey` ——
**触屏手势没有修饰键** ⇒ 手机上永远拿不到 slip、copy、免吸附。

## 解法：给 `dragModifiersOf` 加一层「触屏修饰键覆盖」

它的实现（L4271-4285）只是**原样搬运四个布尔**：

```ts
function dragModifiersOf(event) {
    return { ctrlKey: event.ctrlKey, shiftKey: ..., altKey: ..., metaKey: ... };
}
```

⇒ 在搬运时 **OR 上一个模块级覆盖位**即可：

```ts
altKey: event.altKey || touchModifiers.alt,
```

再给手势层一个 `setTouchModifiers({ alt: true })` 的窗口 ——
「双指长按」时点亮 `alt`，抬手熄灭。

**为什么这比"合成 altKey"好**：`PointerEvent.altKey` 是**只读**的，
伪造事件类既脆弱又要改内核的输入契约；覆盖位只是"读的时候多看一眼"。

## 落点

- 覆盖位与 setter 放在 kernel 宿主模块（`dragModifiersOf` 所在文件），
  用模块级变量 + `window` 上的调试钩子暴露给手势层；
- 4 处调用点**不用改**（它们都走 `dragModifiersOf`）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
F = (ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout"
     / "timeline" / "kernel" / "host" / "timelineKernelHost.ts")
t = F.read_text(encoding="utf-8")

old = """    function dragModifiersOf(event: {
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
    }): KernelDragModifiers {
        return {
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        };
    }"""

assert t.count(old) == 1, f"dragModifiersOf 锚命中 {t.count(old)} 次"

new = """    function dragModifiersOf(event: {
        ctrlKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
        metaKey: boolean;
    }): KernelDragModifiers {
        /* 🔴 2026-09-26（E 组）：**触屏修饰键覆盖**。
         *
         * 背景：slip / copy / 免吸附这些语义**全由修饰键决定**（见上方说明），
         * 而 `PointerEvent` 的 `altKey` 等**在触屏上永远是 false** ——
         * 手机上因此永远拿不到这三件事。
         *
         * 做法：不改事件的 `altKey`（它只读、伪造事件类很脆），
         * 而是**读的时候多看一眼**模块级的 `touchModifiers` 覆盖位。
         * 由手势层（双指长按等）用 `setTouchModifiers` 点亮/熄灭。
         *
         * 好处：4 处调用点全都不用动，且一次覆盖 slip + copy + 免吸附。
         */
        return {
            ctrlKey: event.ctrlKey || touchModifiers.ctrl,
            shiftKey: event.shiftKey || touchModifiers.shift,
            altKey: event.altKey || touchModifiers.alt,
            metaKey: event.metaKey || touchModifiers.meta,
        };
    }"""

t = t.replace(old, new, 1)
print("✓ dragModifiersOf：加触屏修饰键覆盖")

# ── 模块级覆盖位 + setter ───────────────────────────────────────────────────
anchor = "import { resolveClipDoubleClickMode } from \"../interaction/clipDoubleClickMode\";"
assert t.count(anchor) == 1, "import 锚不唯一"
t = t.replace(anchor, anchor + """

/**
 * 触屏"虚拟修饰键"（2026-09-26，E 组）。
 *
 * 触屏没有 Ctrl/Shift/Alt/⌘，但内核的拖拽语义（**copy / slip / 免吸附**）
 * 全靠修饰键分派。这里提供一个**模块级覆盖位**：
 * 手势层（如"双指长按"）点亮它，`dragModifiersOf` 在读取时 OR 进来。
 *
 * ⚠️ 用模块级而非实例状态：`dragModifiersOf` 是宿主内的普通函数，
 * 且覆盖位的语义是"**当前手势会话**的修饰键"，与某个 host 实例无关。
 */
const touchModifiers = { ctrl: false, shift: false, alt: false, meta: false };

/** 手势层设置触屏修饰键（只传要改的字段）。 */
export function setTouchModifiers(patch: Partial<typeof touchModifiers>): void {
    Object.assign(touchModifiers, patch);
}

/** 清空触屏修饰键（手势结束时调用）。 */
export function clearTouchModifiers(): void {
    touchModifiers.ctrl = false;
    touchModifiers.shift = false;
    touchModifiers.alt = false;
    touchModifiers.meta = false;
}""", 1)
print("✓ 加 touchModifiers + setTouchModifiers / clearTouchModifiers")

F.write_text(t, encoding="utf-8")
print("✓ 完成")
