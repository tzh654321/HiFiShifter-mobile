#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D1：上工具栏右对齐处放图标 —— 复制 / 剪切 / 粘贴 + 上移 / 下移。

用户口径：
> 上工具栏右对齐的位置放图标：复制 剪切 粘贴 + -（指对选中范围内的参数线进行上移/下移）

## 好消息：五个能力**全都已存在**

`PianoRollPanel` 里有个统一分发器 `handleEditOp(op, data)`（L5154），
switch 里已有：

```
case "copy"                   ← L5405
case "cut"                    ← L5446
case "paste"                  ← L5501
case "shiftParamUpSelection"  ← L5695
case "shiftParamDownSelection"
```

而且右键菜单（L7693-7698）已经在用同一批 op：
`onCopy={() => void handleEditOp("copy")}` …

⇒ **不需要写任何业务逻辑**，只要加 5 个按钮调用它。
⇒ 这也意味着**长按重复/在途守卫（`beginSelectionParamEdit`）等既有机制自动复用**。

## 落点

`.hs-param-toolbar`（L6912 起，到 L7210 的 `</Flex>` 收尾）末尾、`</Flex>` 之前，
加一个 `marginLeft: "auto"` 的按钮组 ⇒ 自然右对齐。
⚠️ 手机端**复用同一个** `.hs-param-toolbar`（见 `MobileBottomBar` 的注释），
所以改一处两端都生效。
"""
from pathlib import Path

P = (Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
     / "components" / "layout" / "PianoRollPanel.tsx")
t = P.read_text(encoding="utf-8")

# ── ① 补图标 import ─────────────────────────────────────────────────────────
old_imp = """import {
    ChevronDownIcon,
    CursorArrowIcon,
    EyeOpenIcon,
    EyeClosedIcon,
    Link2Icon,
    LinkBreak2Icon,
    Pencil1Icon,
    CheckIcon,
} from "@radix-ui/react-icons";"""
assert t.count(old_imp) == 1, "图标 import 锚不唯一"
t = t.replace(old_imp, """import {
    ChevronDownIcon,
    CursorArrowIcon,
    EyeOpenIcon,
    EyeClosedIcon,
    Link2Icon,
    LinkBreak2Icon,
    Pencil1Icon,
    CheckIcon,
    // D1：选区编辑按钮
    CopyIcon,
    ClipboardIcon,
    PlusIcon,
    MinusIcon,
} from "@radix-ui/react-icons";""", 1)
print("✓ 补了 4 个 Radix 图标 import")

# ── ② 剪切图标（Radix 没有剪刀图标，画一个）─────────────────────────────────
SCISSORS = '''
/**
 * D1：「剪切」图标。Radix Icons 没有剪刀，按同尺寸（15×15、1.2 描边）自绘，
 * 与相邻图标视觉一致。
 */
function ScissorsIcon({ width = 15, height = 15 }: { width?: number; height?: number }) {
    return (
        <svg width={width} height={height} viewBox="0 0 15 15" fill="none">
            <circle cx="4" cy="11.2" r="2.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <circle cx="11.5" cy="11.2" r="2.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path
                d="M5.5 9.6L11.2 1.6M9.9 9.6L4.2 1.6"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
            />
        </svg>
    );
}
'''
anchor = "type ParamToolbarPillProps = {"
assert t.count(anchor) == 1, "ParamToolbarPillProps 锚不唯一"
t = t.replace(anchor, SCISSORS.strip() + "\n\n" + anchor, 1)
print("✓ 加了 ScissorsIcon")

# ── ③ 工具栏右对齐按钮组 ────────────────────────────────────────────────────
lines = t.splitlines()
# 找 hs-param-toolbar 的结束 </Flex>（缩进 20），从它的开始行往后搜
start_idx = next(i for i, l in enumerate(lines) if 'className="hs-param-toolbar"' in l)
end_idx = next(i for i in range(start_idx, len(lines))
               if lines[i].strip() == "</Flex>" and (len(lines[i]) - len(lines[i].lstrip())) == 20)

GROUP = '''                    {/* D1：选区编辑（右对齐）—— 复制 / 剪切 / 粘贴 + 上移 / 下移。
                        全部复用既有 `handleEditOp` 分发器（右键菜单用的是同一批 op），
                        所以长按重复、在途守卫等机制自动继承，无需新增业务逻辑。 */}
                    <Flex gap="1" align="center" style={{ marginLeft: "auto" }}>
                        <IconButton
                            size="1"
                            variant="soft"
                            aria-label={tAny("ctx_copy")}
                            data-tooltip={tAny("ctx_copy")}
                            onClick={() => void handleEditOp("copy")}
                        >
                            <CopyIcon />
                        </IconButton>
                        <IconButton
                            size="1"
                            variant="soft"
                            aria-label={tAny("ctx_cut")}
                            data-tooltip={tAny("ctx_cut")}
                            onClick={() => void handleEditOp("cut")}
                        >
                            <ScissorsIcon />
                        </IconButton>
                        <IconButton
                            size="1"
                            variant="soft"
                            aria-label={tAny("ctx_paste")}
                            data-tooltip={tAny("ctx_paste")}
                            onClick={() => void handleEditOp("paste")}
                        >
                            <ClipboardIcon />
                        </IconButton>
                        <IconButton
                            size="1"
                            variant="soft"
                            aria-label={tAny("shift_param_up")}
                            data-tooltip={tAny("shift_param_up")}
                            onClick={() => void handleEditOp("shiftParamUpSelection")}
                        >
                            <PlusIcon />
                        </IconButton>
                        <IconButton
                            size="1"
                            variant="soft"
                            aria-label={tAny("shift_param_down")}
                            data-tooltip={tAny("shift_param_down")}
                            onClick={() => void handleEditOp("shiftParamDownSelection")}
                        >
                            <MinusIcon />
                        </IconButton>
                    </Flex>
'''

lines.insert(end_idx, GROUP.rstrip("\n"))
t = "\n".join(lines) + "\n"
P.write_text(t, encoding="utf-8")
print(f"✓ 工具栏右对齐按钮组已插入（原 </Flex> 在 {end_idx + 1} 行）")

# ── ④ i18n：补齐 tooltip 文案 ──────────────────────────────────────────────
FE = Path(__file__).resolve().parent.parent / "upstream-src" / "frontend" / "src"
for f, vals in (("zh-CN.ts", {"ctx_copy": "复制", "ctx_cut": "剪切", "ctx_paste": "粘贴",
                              "shift_param_up": "上移参数线", "shift_param_down": "下移参数线"}),
                ("en-US.ts", {"ctx_copy": "Copy", "ctx_cut": "Cut", "ctx_paste": "Paste",
                              "shift_param_up": "Shift param up", "shift_param_down": "Shift param down"})):
    Q = FE / "i18n" / f
    tt = Q.read_text(encoding="utf-8")
    add = []
    for k, v in vals.items():
        if f"{k}:" not in tt:
            add.append(f'    {k}: "{v}",')
    if add:
        a = '    mobile_tool_menu: '
        assert tt.count(a) == 1, f"{f} 锚不唯一"
        tt = tt.replace(a, "\n".join(add) + "\n" + a, 1)
        Q.write_text(tt, encoding="utf-8")
        print(f"✓ {f}: 补了 {list(vals.keys())}")
    else:
        print(f"  · {f} 已齐")
