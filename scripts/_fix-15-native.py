#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#15 二改：改用**原生捕获监听**取锚点（React 的 onPointerDown 在 Radix Trigger 上没跑到）。

实测（模拟器 360×731）：
  · 「视图」文字左 = 142，菜单却仍是 `left=4`（宽 224，右 228）
  · `--hs-menu-anchor` 读出来是**空字符串** ⇒ 说明 `openMenuAt` 根本没执行

为什么"宽 224 却还被推左"：Radix 判溢出用的是**内容的自然宽度**（~300+），
不受我们 CSS 的 `max-width` 影响 ⇒ 142+300 > 360 ⇒ 推左到底。

⇒ 所以必须让 CSS 变量**真的设上**（把 max-width 压到视口内），Radix 才认为放得下。
React 的 `onPointerDown` 在 Radix Trigger 上没能拿到（它有自己的一套 pointer 处理），
改用 **document 捕获阶段的原生监听 + `data-hs-menu-trigger` 标记** —— 这条路一定拿得到。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
mb = ROOT / "upstream-src" / "frontend" / "src" / "components" / "layout" / "MenuBar.tsx"
t = mb.read_text(encoding="utf-8")

# ① 用 useEffect + 原生捕获监听替换原来的 openMenuAt 调用方式
old = """    function openMenuAt(e: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const left = Math.max(0, r.left);
        document.documentElement.style.setProperty("--hs-menu-anchor", `${left}px`);
        // #15②：放不下就靠**右上角**。上界取「最宽菜单的内容宽」粗估（视图菜单约 460px）——
        // 宁可估大一点：宁可提前切到右对齐，也不要出现"先贴左再被推"的跳动。
        const EST_MENU_W = 460;
        setMenuAlign(left + EST_MENU_W > window.innerWidth ? "end" : "start");
    }"""
new = """    /**
     * #15：菜单锚点。
     *
     * ⚠️ 2026-09-24 实测教训：把 `onPointerDown={openMenuAt}` 直接挂在
     * `DropdownMenu.Trigger` 上**拿不到** —— Radix 对 Trigger 的指针事件有自己的一套
     * 处理，实测 `--hs-menu-anchor` 一直是空串（于是 max-width 没生效，Radix 仍按
     * 内容的自然宽度判溢出，把菜单推到 `left=4`）。
     * ⇒ 改用**document 捕获阶段的原生监听** + `data-hs-menu-trigger` 标记，绕开这层。
     */
    React.useEffect(() => {
        const onDown = (ev: Event) => {
            const t = (ev.target as HTMLElement | null)?.closest?.("[data-hs-menu-trigger]");
            if (!t) return;
            const r = (t as HTMLElement).getBoundingClientRect();
            const left = Math.max(0, r.left);
            document.documentElement.style.setProperty("--hs-menu-anchor", `${left}px`);
            // #15②：放不下就靠**右上角**。用内容自然宽度粗估（最宽的「视图」菜单约 460px），
            // 宁可估大：宁可提前切右对齐，也不要"先贴左、再被推"的跳动。
            setMenuAlign(left + 460 > window.innerWidth ? "end" : "start");
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, []);"""
assert t.count(old) == 1, "openMenuAt 锚不唯一"
t = t.replace(old, new, 1)

# ② Trigger 上换成 data 标记（去掉失效的 onPointerDown）
t = t.replace("<DropdownMenu.Trigger onPointerDown={openMenuAt}", "<DropdownMenu.Trigger data-hs-menu-trigger")

mb.write_text(t, encoding="utf-8")
print("✓ MenuBar.tsx：改用原生捕获监听 + data-hs-menu-trigger")
print(f"  Trigger 标记数：{t.count('data-hs-menu-trigger')}")
