#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skill 追加：触屏表达修饰键 + "找唯一裁决点"方法论。"""
from pathlib import Path

P = Path("C:/Users/tzh/.workbuddy/skills/tauri2-android-bringup/SKILL.md")
t = P.read_text(encoding="utf-8")

ADD = """

---

## 触屏没有修饰键：给内核加「**虚拟修饰键覆盖位**」

**2026-09-26 实测**（HiFiShifter：手机要"双指长按并划动 = slip"）。

### 问题

桌面应用里大量语义由**修饰键**分派，例如：

```
dragModifiersOf：Ctrl / Shift / Alt / ⌘ 决定 copy / slip / 免吸附 等语义
```

而 `PointerEvent` 的 `ctrlKey` / `altKey` … 在**触屏上永远是 false**
⇒ 手机上这**三件事一起拿不到**。

### 🔑 先找「唯一裁决点」

**动手前先问：这几件事是不是挂在同一个开关上？**
本例所有语义都收口在一个函数里，而它只是**原样搬运四个布尔**：

```ts
function dragModifiersOf(event) {
    return { ctrlKey: event.ctrlKey, shiftKey: ..., altKey: ..., metaKey: ... };
}
```

⇒ **一处改动解决三件事**，比逐个功能改手势划算得多。
（如果分散在多处，才需要逐个改。）

### 做法：读的时候多看一眼

```ts
const touchModifiers = { ctrl: false, shift: false, alt: false, meta: false };
export function setTouchModifiers(patch) { Object.assign(touchModifiers, patch); }
export function clearTouchModifiers() { /* 全清零 */ }

function dragModifiersOf(event) {
    return {
        ctrlKey: event.ctrlKey || touchModifiers.ctrl,   // ← 只加这一个 `||`
        ...
        altKey: event.altKey || touchModifiers.alt,
    };
}
```

**为什么这比"合成 `PointerEvent.altKey`"好**：那个字段是**只读**的，
伪造事件类既脆弱、又要改内核的**输入契约**；覆盖位只是"读的时候多看一眼"，
**所有调用点一行都不用动**。

再由手势层点亮/熄灭（如：双指按住 500ms ⇒ `set({alt:true})`，抬手 ⇒ clear）。

### ⚠️ 时序：必须在 `pointerdown` **之前**点亮

修饰键是**在 `pointerdown` 时快照**的（内核注释原话：
「收尾时才读事件早就没有修饰键状态了」）⇒
手势顺序必须是「**先按住/长按点亮 → 再动手指拖**」，
而不是「拖到一半再补修饰键」。

⇒ 设计触屏手势时，凡是"改变拖拽语义"的操作，
都要设法在**按下那一刻或之前**确定，不能等到移动过程中。

### 另一个同类问题：`PointerEvent` 字段只读

同类只能读不能写的还有 `pointerType` 等。需要"伪造"时优先考虑
**在消费侧加覆盖层**（如本例），而不是去构造假事件 ——
假事件要么被 `instanceof` 拦、要么丢掉 `isTrusted`，且后续维护成本高。
"""

t = t.rstrip() + ADD
P.write_text(t, encoding="utf-8")
print("✓ skill 追加「触屏虚拟修饰键 + 唯一裁决点」")
print("总行数:", len(t.splitlines()))
