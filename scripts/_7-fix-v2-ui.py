#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""#7 第二轮修：修回归 + 用户追加的四项 UI 要求。

## 回归：「涉及到颜色的图形不见了」

根因：我把浮层用 `createPortal` 挂到了 `document.body`，但浮层里用的是
**`--accent-9`** —— 这个变量由 **Radix Themes 注入到它的主题容器上**，
portal 到 body 之后**不在那个作用域里** ⇒ 变量解析失败 ⇒ 滑条 track/thumb 颜色失效。
（对照：上游 `TimelinePanel` 那几个 portal 用的都是 `--qt-*`，那些定义在 `:root`，所以没事。）
⇒ **不用 portal**，把浮层放回组件树内 ⇒ 自然继承全部 CSS 变量。
浮层是 `position: fixed`，普通祖先的 `overflow: hidden` **裁不到它**（除非祖先有 transform）。

## 用户追加的四项

1. **去掉「完成」按钮**
2. **点框外 = 完成**（保留"拍数栏 / 钢琴栏 / 上下工具栏 / 菜单栏"四类为**非空白**）
3. **框的底色改透明** —— 用户理由：*「调完曲线需要预览音频再确认」*
   ⇒ 浮层不能挡住波形/曲线，用户要能**边调边播着看**，最后点框外收工。
4. **#7 完善后再做 #17**
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "upstream-src" / "frontend" / "src"

# ══ ① 浮层：去按钮 / 透明底 / 不依赖 portal 也能拿到主题变量 ══════════════════
OV = FE / "components" / "layout" / "pianoRoll" / "VibratoAdjustOverlay.tsx"
t = OV.read_text(encoding="utf-8")

# 去掉「完成」按钮
old_btn_block = """            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    style={{
                        fontSize: 11,
                        padding: "3px 11px",
                        borderRadius: 6,
                        border: "1px solid transparent",
                        // 主题强调色（与 .qt-range 的 thumb 同一套变量）
                        background: "var(--accent-9)",
                        color: "var(--accent-contrast, #fff)",
                        cursor: "pointer",
                        touchAction: "none",
                    }}
                >
                    完成
                </button>
            </div>
"""
assert t.count(old_btn_block) == 1, "完成键锚不唯一"
t = t.replace(old_btn_block, "", 1)
print("✓ 去掉「完成」按钮")

# 面板：透明底 + 保留边框/阴影以便界定区域
old_panel = """            className="fixed bg-qt-window border border-qt-border"
            style={{
                left: pos.left,
                top: pos.top,
                width: PANEL_W,
                zIndex: 60,
                borderRadius: 10,
                padding: "7px 9px",
                boxShadow: "0 12px 28px rgba(0,0,0,0.3)",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}"""
new_panel = """            className="fixed border border-qt-border"
            style={{
                left: pos.left,
                top: pos.top,
                width: PANEL_W,
                zIndex: 60,
                borderRadius: 10,
                padding: "7px 9px",
                /* 🔴 用户口径：「调完曲线需要预览音频再确认」⇒ 浮层底色必须透明，
                   否则会挡住下面的波形/曲线，没法边调边看。只留边框 + 轻微阴影界定范围。 */
                background: "transparent",
                boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
                backdropFilter: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
            }}"""
assert t.count(old_panel) == 1, "面板锚不唯一"
t = t.replace(old_panel, new_panel, 1)
print("✓ 面板底色改透明（保留边框+阴影）")

# onClose 现在只由「点框外」触发，浮层内部不再需要它 —— 但保留 prop 以免上层改动过大
OV.write_text(t, encoding="utf-8")

# ══ ② PianoRollPanel：不用 portal（修变量作用域）+ 点框外完成 ════════════════
PP = FE / "components" / "layout" / "PianoRollPanel.tsx"
t = PP.read_text(encoding="utf-8")

old_portal = """    /** #7：浮层用 portal 挂到 body，避免受面板祖先的 overflow 裁剪。 */
    const vibratoAdjustOverlay = vibratoAdjust
        ? createPortal(
              <VibratoAdjustOverlay
                  info={vibratoAdjust}
                  range={currentParamRange ?? { min: -12, max: 12 }}
                  onChange={(next) => {
                      vibratoAdjustFnRef.current?.(next);
                      // 浮层上的数值同步更新，拖动时读数才不会跳回旧值
                      setVibratoAdjust((prev) => (prev ? { ...prev, ...next } : prev));
                  }}
                  onClose={closeVibratoAdjust}
              />,
              document.body,
          )
        : null;"""
new_portal = """    /**
     * #7：浮层**不用 portal** —— 直接渲染在组件树里。
     *
     * 🔴 回归教训：先前用 `createPortal(…, document.body)`，结果浮层里的
     * `--accent-9`（Radix 主题变量，注入在主题容器上）**解析不到** ⇒
     * 滑条的颜色图形整个消失（用户报「涉及到颜色的图形还不见了」）。
     * 上游那几个 portal 用的都是 `--qt-*`（`:root` 全局），所以它们没这个问题。
     *
     * 放回组件树后继承全部变量；浮层是 `position: fixed`，
     * 祖先的 `overflow: hidden` **裁不到 fixed 元素**（除非祖先有 transform，这里没有）。
     */
    const vibratoAdjustOverlay = vibratoAdjust ? (
        <VibratoAdjustOverlay
            info={vibratoAdjust}
            range={currentParamRange ?? { min: -12, max: 12 }}
            onChange={(next) => {
                vibratoAdjustFnRef.current?.(next);
                // 浮层上的数值同步更新，拖动时读数才不会跳回旧值
                setVibratoAdjust((prev) => (prev ? { ...prev, ...next } : prev));
            }}
            onClose={closeVibratoAdjust}
        />
    ) : null;"""
assert t.count(old_portal) == 1, "portal 锚不唯一"
t = t.replace(old_portal, new_portal, 1)
print("✓ 去掉 portal（继承 CSS 变量，修「图形不见了」）")

# 点框外判定：区域标记扩展
old_keep = """        const KEEP_SELECTORS = [
            '[data-hs-vibrato-adjust="true"]', // 浮层自身
            '[data-hs-ruler]',                 // 拍数栏（时间线标尺）
            '[data-hs-piano-keys]',            // 钢琴栏
            '[data-hs-toolbar]',               // 上下工具栏
            '[role="menu"]',                   // 菜单栏与其下拉
            '[role="menubar"]',
            '[data-radix-popper-content-wrapper]',
        ].join(",");"""
new_keep = """        /**
         * 用户口径：确认关闭的「空白处」**不包括**拍数栏 / 钢琴栏 / 上下工具栏 / 菜单栏。
         * 这些区域的点击各有语义（seek / 选音高 / 切工具 / 开菜单），不该被"关闭浮层"吃掉。
         * ⚠️ 做多重兜底：既认 data 标记，也认上游实际的类名，避免因为没人打标记而全部失效。
         */
        const KEEP_SELECTORS = [
            '[data-hs-vibrato-adjust="true"]', // 浮层自身
            '[data-hs-ruler]',                 // 拍数栏（可能有 data 标记）
            '.hs-ruler',                       // 拍数栏（实际类名）
            '[data-hs-piano-keys]',
            '.hs-piano-keys',                  // 钢琴栏
            '[data-hs-toolbar]',
            '.hs-param-toolbar',               // 参数工具行
            '.hs-actionbar',                   // 上下工具栏
            '[role="menu"]',                   // 菜单栏与其下拉
            '[role="menubar"]',
            '[data-radix-popper-content-wrapper]',
            '[data-radix-menu-content]',
        ].join(",");"""
assert t.count(old_keep) == 1, "KEEP_SELECTORS 锚不唯一"
t = t.replace(old_keep, new_keep, 1)
print("✓ 点框外判定的非空白区域：加了类名兜底")

PP.write_text(t, encoding="utf-8")
print("\n下一步：tsc → 构建 → 装机 → 用户操作 → 读日志（vibLog 已通）")
